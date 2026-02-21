import path from "node:path";

import { createMetadata, type Item, type ItemMetadata } from "@re/core";
import { ClozeType, QAType } from "@re/types";
import { DeckManager, scanDecks } from "@re/workspace";
import { Effect, Either, Layer, Option } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import type { EditorWindowParams } from "@main/editor-window";
import { NodeServicesLive } from "@main/effect/node-services";
import type { SettingsRepository } from "@main/settings/repository";
import type { AppContract } from "@shared/rpc/contracts";
import { CardEdited } from "@shared/rpc/contracts";
import { EditorOperationError } from "@shared/rpc/schemas/editor";

import {
  ReviewServicesLive,
  toErrorMessage,
  toStringId,
  validateDeckAccess,
  getConfiguredRootPath,
  findCardLocationById,
} from "./shared";
import type { AppEventPublisher, OpenEditorWindow } from "../handlers";

type EditorCardType = "qa" | "cloze";

type DuplicateIndexEntry = {
  readonly deckPath: string;
  readonly cardIds: readonly string[];
};

type DuplicateIndexCache = {
  readonly rootPath: string;
  readonly byKey: Map<string, DuplicateIndexEntry[]>;
};

const toEditorError = (error: unknown): EditorOperationError =>
  new EditorOperationError({ message: toErrorMessage(error) });

const resolveEditorItemType = (cardType: EditorCardType) =>
  cardType === "qa" ? QAType : ClozeType;

type EditorItemType<TParsed> = {
  readonly parse: (content: string) => Effect.Effect<TParsed, unknown>;
  readonly cards: (parsed: TParsed) => readonly unknown[];
};

const parseEditorCardCount = <TParsed>(
  itemType: EditorItemType<TParsed>,
  content: string,
): Effect.Effect<number, EditorOperationError> =>
  itemType.parse(content).pipe(
    Effect.map((parsed) => itemType.cards(parsed).length),
    Effect.mapError(toEditorError),
  );

const parseEditorContent = (
  cardType: EditorCardType,
  content: string,
): Effect.Effect<number, EditorOperationError> =>
  cardType === "qa"
    ? parseEditorCardCount(QAType, content)
    : parseEditorCardCount(ClozeType, content);

const normalizeDuplicateContent = (content: string): string => content.trim();

const duplicateKey = (cardType: EditorCardType, content: string): string =>
  `${cardType}:${normalizeDuplicateContent(content)}`;

const ensureTrailingNewline = (content: string): string =>
  content.endsWith("\n") ? content : `${content}\n`;

const uniqueClozeIndices = (
  content: string,
): Effect.Effect<readonly number[], EditorOperationError> =>
  ClozeType.parse(content).pipe(
    Effect.map((parsed) => {
      const indices: number[] = [];
      let last: number | null = null;

      for (const deletion of parsed.deletions) {
        if (deletion.index !== last) {
          indices.push(deletion.index);
          last = deletion.index;
        }
      }

      return indices;
    }),
    Effect.mapError(toEditorError),
  );

const detectEditorCardType = (item: Item): Effect.Effect<EditorCardType, EditorOperationError> =>
  Effect.gen(function* () {
    const qaResult = yield* Effect.either(QAType.parse(item.content));
    const clozeResult = yield* Effect.either(ClozeType.parse(item.content));

    const qaCards = Either.isRight(qaResult) ? QAType.cards(qaResult.right).length : -1;
    const clozeCards = Either.isRight(clozeResult) ? ClozeType.cards(clozeResult.right).length : -1;

    const qaMatches = qaCards === item.cards.length;
    const clozeMatches = clozeCards === item.cards.length;

    if (qaMatches && !clozeMatches) {
      return "qa";
    }

    if (clozeMatches && !qaMatches) {
      return "cloze";
    }

    if (qaMatches && clozeMatches) {
      return item.content.includes("{{c") ? "cloze" : "qa";
    }

    if (Either.isRight(clozeResult) && !Either.isRight(qaResult)) {
      return "cloze";
    }

    if (Either.isRight(qaResult) && !Either.isRight(clozeResult)) {
      return "qa";
    }

    return yield* Effect.fail(
      new EditorOperationError({
        message: "Unable to determine card type for existing item.",
      }),
    );
  });

const hasCardIdOverlap = (
  cardIds: readonly string[],
  excludedIds: ReadonlySet<string>,
): boolean => {
  for (const cardId of cardIds) {
    if (excludedIds.has(cardId)) {
      return true;
    }
  }
  return false;
};

type EditorHandlerKeys =
  | "AppendItem"
  | "ReplaceItem"
  | "GetItemForEdit"
  | "CheckDuplicates"
  | "OpenEditorWindow";

export type EditorHandlersResult = {
  readonly handlers: Pick<Implementations<AppContract>, EditorHandlerKeys>;
  readonly markDuplicateIndexDirty: () => void;
};

export const createEditorHandlers = (
  settingsRepository: SettingsRepository,
  publish: AppEventPublisher,
  openEditorWindow: OpenEditorWindow,
): EditorHandlersResult => {
  let duplicateIndexCache: DuplicateIndexCache | null = null;
  let duplicateIndexGeneration = 0;

  const invalidateDuplicateIndex = (): void => {
    duplicateIndexGeneration += 1;
    duplicateIndexCache = null;
  };

  const markDuplicateIndexDirty = (): void => {
    invalidateDuplicateIndex();
  };

  const rebuildDuplicateIndex = (rootPath: string) =>
    Effect.gen(function* () {
      type IndexRecord = {
        readonly key: string;
        readonly entry: DuplicateIndexEntry;
      };

      const deckManager = yield* DeckManager;
      const scanned = yield* scanDecks(rootPath).pipe(
        Effect.provide(NodeServicesLive),
        Effect.mapError(toEditorError),
      );
      const byKey = new Map<string, DuplicateIndexEntry[]>();

      const recordsByDeck = yield* Effect.forEach(
        scanned.decks,
        (deck) =>
          deckManager.readDeck(deck.absolutePath).pipe(
            Effect.option,
            Effect.flatMap((parsedDeckOption) => {
              if (Option.isNone(parsedDeckOption)) {
                return Effect.succeed([] as readonly IndexRecord[]);
              }

              return Effect.forEach(parsedDeckOption.value.items, (item) =>
                detectEditorCardType(item).pipe(
                  Effect.option,
                  Effect.map((itemCardTypeOption): readonly IndexRecord[] => {
                    if (Option.isNone(itemCardTypeOption)) {
                      return [];
                    }

                    return [
                      {
                        key: duplicateKey(itemCardTypeOption.value, item.content),
                        entry: {
                          deckPath: deck.absolutePath,
                          cardIds: item.cards.map((card) => toStringId(card.id)),
                        },
                      },
                    ];
                  }),
                ),
              ).pipe(Effect.map((records) => records.flat()));
            }),
          ),
        { concurrency: "unbounded" },
      );

      for (const deckRecords of recordsByDeck) {
        for (const { key, entry } of deckRecords) {
          const current = byKey.get(key) ?? [];
          byKey.set(key, [...current, entry]);
        }
      }

      return byKey;
    });

  const ensureDuplicateIndex = (rootPath: string) =>
    Effect.gen(function* () {
      const resolvedRootPath = path.resolve(rootPath);

      while (true) {
        const currentCache = duplicateIndexCache;
        if (currentCache && currentCache.rootPath === resolvedRootPath) {
          return currentCache;
        }

        const rebuildStartGeneration = duplicateIndexGeneration;
        const byKey = yield* rebuildDuplicateIndex(resolvedRootPath);

        if (duplicateIndexGeneration !== rebuildStartGeneration) {
          continue;
        }

        const nextCache: DuplicateIndexCache = { rootPath: resolvedRootPath, byKey };
        duplicateIndexCache = nextCache;
        return nextCache;
      }
    });

  const handlers: Pick<Implementations<AppContract>, EditorHandlerKeys> = {
    AppendItem: ({ deckPath, content, cardType }) =>
      Effect.gen(function* () {
        yield* validateDeckAccess(settingsRepository, {
          deckPath,
          mapSettingsError: toEditorError,
          makeMissingRootError: () =>
            new EditorOperationError({ message: "Workspace root path is not configured." }),
          makeOutsideRootError: (invalidDeckPath) =>
            new EditorOperationError({
              message: `Deck path is outside workspace root: ${invalidDeckPath}`,
            }),
        });

        const itemType = resolveEditorItemType(cardType);
        const cardCount = yield* parseEditorContent(cardType, content);
        const cards = Array.from({ length: cardCount }, () => createMetadata());

        const deckManager = yield* DeckManager;
        yield* deckManager.appendItem(deckPath, { cards, content }, itemType);

        markDuplicateIndexDirty();

        return {
          cardIds: cards.map((card) => toStringId(card.id)),
        };
      }).pipe(
        Effect.provide(Layer.mergeAll(ReviewServicesLive, NodeServicesLive)),
        Effect.mapError(toEditorError),
      ),
    ReplaceItem: ({ deckPath, cardId, content, cardType }) =>
      Effect.gen(function* () {
        yield* validateDeckAccess(settingsRepository, {
          deckPath,
          mapSettingsError: toEditorError,
          makeMissingRootError: () =>
            new EditorOperationError({ message: "Workspace root path is not configured." }),
          makeOutsideRootError: (invalidDeckPath) =>
            new EditorOperationError({
              message: `Deck path is outside workspace root: ${invalidDeckPath}`,
            }),
        });

        const newItemType = resolveEditorItemType(cardType);
        const expectedNewCardCount = yield* parseEditorContent(cardType, content);

        const deckManager = yield* DeckManager;
        const parsedDeck = yield* deckManager.readDeck(deckPath);
        const location = findCardLocationById(parsedDeck, cardId);

        if (!location) {
          return yield* Effect.fail(
            new EditorOperationError({
              message: `Card not found: ${cardId}`,
            }),
          );
        }

        const oldItem = location.item;
        const oldCardType = yield* detectEditorCardType(oldItem);

        let mergedMetadata: readonly ItemMetadata[];

        if (oldCardType !== cardType) {
          mergedMetadata = Array.from({ length: expectedNewCardCount }, () => createMetadata());
        } else if (cardType === "qa") {
          mergedMetadata = [oldItem.cards[0] ?? createMetadata()];
        } else {
          const oldIndices = yield* uniqueClozeIndices(oldItem.content);
          const newIndices = yield* uniqueClozeIndices(content);
          const metadataByIndex = new Map<number, ItemMetadata>();

          oldIndices.forEach((index, indexPosition) => {
            const metadata = oldItem.cards[indexPosition];
            if (metadata) {
              metadataByIndex.set(index, metadata);
            }
          });

          mergedMetadata = newIndices.map(
            (index) => metadataByIndex.get(index) ?? createMetadata(),
          );
        }

        const nextContent = ensureTrailingNewline(content);
        yield* deckManager.replaceItem(
          deckPath,
          cardId,
          { cards: mergedMetadata, content: nextContent },
          newItemType,
        );

        markDuplicateIndexDirty();

        yield* publish(CardEdited, { deckPath, cardId });

        return { cardIds: mergedMetadata.map((card) => toStringId(card.id)) };
      }).pipe(
        Effect.provide(Layer.mergeAll(ReviewServicesLive, NodeServicesLive)),
        Effect.mapError(toEditorError),
      ),
    GetItemForEdit: ({ deckPath, cardId }) =>
      Effect.gen(function* () {
        yield* validateDeckAccess(settingsRepository, {
          deckPath,
          mapSettingsError: toEditorError,
          makeMissingRootError: () =>
            new EditorOperationError({ message: "Workspace root path is not configured." }),
          makeOutsideRootError: (invalidDeckPath) =>
            new EditorOperationError({
              message: `Deck path is outside workspace root: ${invalidDeckPath}`,
            }),
        });

        const deckManager = yield* DeckManager;
        const parsed = yield* deckManager.readDeck(deckPath);
        const location = findCardLocationById(parsed, cardId);

        if (!location) {
          return yield* Effect.fail(
            new EditorOperationError({
              message: `Card not found: ${cardId}`,
            }),
          );
        }

        const itemCardType = yield* detectEditorCardType(location.item);

        return {
          content: location.item.content,
          cardType: itemCardType,
          cardIds: location.item.cards.map((card) => toStringId(card.id)),
        };
      }).pipe(Effect.provide(ReviewServicesLive), Effect.mapError(toEditorError)),
    CheckDuplicates: ({ content, cardType, rootPath, excludeCardIds }) =>
      Effect.gen(function* () {
        const configuredRootPath = yield* getConfiguredRootPath(
          settingsRepository,
          toEditorError,
          () => new EditorOperationError({ message: "Workspace root path is not configured." }),
        );
        const resolvedConfiguredRoot = path.resolve(configuredRootPath);
        const resolvedRequestedRoot = path.resolve(rootPath);

        if (resolvedConfiguredRoot !== resolvedRequestedRoot) {
          return yield* Effect.fail(
            new EditorOperationError({
              message: `Root path mismatch. Expected ${configuredRootPath}, received ${rootPath}.`,
            }),
          );
        }

        const parseResult = yield* Effect.either(parseEditorContent(cardType, content));
        if (Either.isLeft(parseResult)) {
          return {
            isDuplicate: false,
            matchingDeckPath: Option.none(),
          };
        }

        const index = yield* ensureDuplicateIndex(resolvedConfiguredRoot);
        const entries = index.byKey.get(duplicateKey(cardType, content)) ?? [];
        const excludedIds = new Set(excludeCardIds);
        const match = entries.find((entry) => !hasCardIdOverlap(entry.cardIds, excludedIds));

        return {
          isDuplicate: Boolean(match),
          matchingDeckPath: match ? Option.some(match.deckPath) : Option.none(),
        };
      }).pipe(Effect.provide(ReviewServicesLive), Effect.mapError(toEditorError)),
    OpenEditorWindow: (params) =>
      Effect.sync(() => {
        const normalizedParams: EditorWindowParams =
          params.mode === "create"
            ? params.deckPath
              ? { mode: "create", deckPath: params.deckPath }
              : { mode: "create" }
            : params;
        openEditorWindow(normalizedParams);
        return {};
      }),
  };

  return { handlers, markDuplicateIndexDirty };
};
