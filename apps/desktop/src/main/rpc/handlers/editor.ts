import path from "node:path";

import { adaptItemType, createMetadata, reconcileCards, type Item } from "@re/core";
import { ClozeType, QAType, resolveBuiltinItem } from "@re/item-types";
import { DeckManager, importDeckImageAssetFromBytes, scanDecks } from "@re/workspace";
import type { FileSystem, Path } from "@effect/platform";
import { Effect, Either, Option } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import type { EditorWindowParams } from "@main/editor-window";
import { findCardLocationById } from "@main/card-location";
import {
  AppEventPublisherService,
  DuplicateIndexInvalidationService,
  EditorWindowManagerService,
  SettingsRepositoryService,
} from "@main/di";
import { toErrorMessage } from "@main/utils/format";
import type { AppContract } from "@shared/rpc/contracts";
import { CardEdited, CardsDeleted } from "@shared/rpc/contracts";
import { EditorOperationError } from "@shared/rpc/schemas/editor";

import {
  provideHandlerServices,
  validateDeckAccessAs,
  validateRequestedRootPathAs,
} from "./shared";

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
  cardType === "qa" ? adaptItemType(QAType) : adaptItemType(ClozeType);

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

const MAX_IMPORTED_IMAGE_BYTES = 10 * 1024 * 1024;

const detectEditorCardType = (item: Item) =>
  resolveBuiltinItem(item).pipe(
    Effect.map(({ type }): EditorCardType => (type.name === "cloze" ? "cloze" : "qa")),
  );

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
  | "DeleteItems"
  | "ImportDeckImageAsset"
  | "OpenEditorWindow";

type EditorHandlerRuntime = DeckManager | FileSystem.FileSystem | Path.Path;

export const createEditorHandlers = () =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepositoryService;
    const appEventPublisher = yield* AppEventPublisherService;
    const editorWindowManager = yield* EditorWindowManagerService;
    const duplicateIndexInvalidation = yield* DuplicateIndexInvalidationService;
    const publish = appEventPublisher.publish;
    const openEditorWindow = editorWindowManager.openEditorWindow;

    let duplicateIndexCache: DuplicateIndexCache | null = null;
    let duplicateIndexGeneration = 0;

    const invalidateDuplicateIndex = (): void => {
      duplicateIndexGeneration += 1;
      duplicateIndexCache = null;
    };

    const markDuplicateIndexDirty = (): void => {
      invalidateDuplicateIndex();
    };

    duplicateIndexInvalidation.registerListener(markDuplicateIndexDirty);

    const rebuildDuplicateIndex = (rootPath: string) =>
      Effect.gen(function* () {
        type IndexRecord = {
          readonly key: string;
          readonly entry: DuplicateIndexEntry;
        };

        const deckManager = yield* DeckManager;
        const scanned = yield* scanDecks(rootPath).pipe(Effect.mapError(toEditorError));
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
                            cardIds: item.cards.map((card) => card.id),
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

    const handlers: Pick<Implementations<AppContract, EditorHandlerRuntime>, EditorHandlerKeys> = {
      AppendItem: ({ deckPath, content, cardType }) =>
        Effect.gen(function* () {
          yield* validateDeckAccessAs(
            settingsRepository,
            deckPath,
            (m) => new EditorOperationError({ message: m }),
          );

          const itemType = resolveEditorItemType(cardType);
          const cardCount = yield* parseEditorContent(cardType, content);
          const cards = Array.from({ length: cardCount }, () => createMetadata());

          const deckManager = yield* DeckManager;
          yield* deckManager.appendItem(deckPath, { cards, content }, itemType);

          markDuplicateIndexDirty();

          return {
            cardIds: cards.map((card) => card.id),
          };
        }).pipe(Effect.mapError(toEditorError)),
      ReplaceItem: ({ deckPath, cardId, content, cardType, resetScheduling }) =>
        Effect.gen(function* () {
          yield* validateDeckAccessAs(
            settingsRepository,
            deckPath,
            (m) => new EditorOperationError({ message: m }),
          );

          const newItemType = resolveEditorItemType(cardType);
          const newCards = yield* newItemType.parseCards(content);
          const deckManager = yield* DeckManager;
          const saved = yield* deckManager.modifyItem(
            deckPath,
            cardId,
            (current) =>
              Effect.gen(function* () {
                const previous = yield* resolveBuiltinItem(current);
                if (previous.type.name !== newItemType.name) {
                  return { content, cards: newCards.map(() => createMetadata()) };
                }
                const matches = yield* reconcileCards(
                  { keys: previous.cards.map((card) => card.key), cards: current.cards },
                  newCards.map((card) => card.key),
                );
                return {
                  content,
                  cards: matches.map((match) => Option.getOrElse(match, createMetadata)),
                };
              }).pipe(
                Effect.catchTag("ItemCardCountMismatch", (error) =>
                  resetScheduling
                    ? Effect.sync(() => ({ content, cards: newCards.map(() => createMetadata()) }))
                    : Effect.fail(error),
                ),
              ),
            newItemType,
          );

          markDuplicateIndexDirty();

          yield* publish(CardEdited, { deckPath, cardId });

          return { cardIds: saved.cards.map((card) => card.id) };
        }).pipe(Effect.mapError(toEditorError)),
      GetItemForEdit: ({ deckPath, cardId }) =>
        Effect.gen(function* () {
          yield* validateDeckAccessAs(
            settingsRepository,
            deckPath,
            (m) => new EditorOperationError({ message: m }),
          );

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

          const detected = yield* detectEditorCardType(location.item).pipe(
            Effect.map((cardType) => ({ cardType, requiresSchedulingReset: false })),
            Effect.catchTag("ItemCardCountMismatch", (error) =>
              Effect.succeed({
                cardType:
                  error.parseableTypes[0].name === "cloze" ? ("cloze" as const) : ("qa" as const),
                requiresSchedulingReset: true,
              }),
            ),
          );

          return {
            content: location.item.content,
            ...detected,
            cardIds: location.item.cards.map((card) => card.id),
          };
        }).pipe(Effect.mapError(toEditorError)),
      CheckDuplicates: ({ content, cardType, rootPath, excludeCardIds }) =>
        Effect.gen(function* () {
          const configuredRootPath = yield* validateRequestedRootPathAs(
            settingsRepository,
            rootPath,
            (m) => new EditorOperationError({ message: m }),
          );
          const resolvedConfiguredRoot = path.resolve(configuredRootPath);

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
        }).pipe(Effect.mapError(toEditorError)),
      DeleteItems: ({ items }) =>
        Effect.gen(function* () {
          const deckManager = yield* DeckManager;

          const byDeck = new Map<string, string[]>();
          for (const item of items) {
            const existing = byDeck.get(item.deckPath);
            if (existing) {
              existing.push(item.cardId);
            } else {
              byDeck.set(item.deckPath, [item.cardId]);
            }
          }

          for (const [deckPath, cardIds] of byDeck) {
            yield* validateDeckAccessAs(
              settingsRepository,
              deckPath,
              (m) => new EditorOperationError({ message: m }),
            );

            yield* Effect.forEach(cardIds, (cardId) => deckManager.removeItem(deckPath, cardId), {
              concurrency: 1,
            });
          }

          markDuplicateIndexDirty();

          yield* publish(CardsDeleted, {
            items: items.map((i) => ({ deckPath: i.deckPath, cardId: i.cardId })),
          });

          return {};
        }).pipe(Effect.mapError(toEditorError)),
      ImportDeckImageAsset: ({ deckPath, extension, bytes }) =>
        Effect.gen(function* () {
          const rootPath = yield* validateDeckAccessAs(
            settingsRepository,
            deckPath,
            (m) => new EditorOperationError({ message: m }),
          );

          if (bytes.length > MAX_IMPORTED_IMAGE_BYTES) {
            return yield* Effect.fail(
              new EditorOperationError({
                message: "Image exceeds maximum size of 10 MiB.",
              }),
            );
          }

          const imported = yield* importDeckImageAssetFromBytes({
            rootPath,
            deckPath,
            bytes,
            extension,
          }).pipe(
            Effect.catchTags({
              InvalidWorkspaceImageAsset: (error) => {
                if (error.reason === "unsupported_file_extension") {
                  return Effect.fail(
                    new EditorOperationError({
                      message: `Unsupported image extension: ${extension}`,
                    }),
                  );
                }

                if (error.reason === "deck_outside_root") {
                  return Effect.fail(
                    new EditorOperationError({
                      message: `Deck path is outside workspace root: ${deckPath}`,
                    }),
                  );
                }

                return Effect.fail(
                  new EditorOperationError({
                    message: `Unable to import image asset (${error.reason}).`,
                  }),
                );
              },
              ImportDeckImageAssetOperationError: (error) =>
                Effect.fail(
                  new EditorOperationError({
                    message: `Failed to store image asset: ${error.message}`,
                  }),
                ),
            }),
          );

          return {
            contentHash: imported.contentHash,
            extension: imported.extension,
            workspaceRelativePath: imported.workspaceRelativePath,
            deckRelativePath: imported.deckRelativePath,
          };
        }).pipe(Effect.mapError(toEditorError)),
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

    return provideHandlerServices(handlers);
  });
