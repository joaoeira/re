import path from "node:path";

import { createMetadata, inferType, parseFile, type Item, type ItemMetadata, type ParsedFile } from "@re/core";
import { ClozeType, QAType } from "@re/types";
import {
  DeckManager,
  DeckManagerLive,
  ReviewQueueBuilder,
  ReviewQueueBuilderLive,
  Scheduler,
  SchedulerLive,
  ShuffledOrderingStrategy,
  snapshotWorkspace,
  scanDecks,
} from "@re/workspace";
import { Effect, Either, Layer, Option } from "effect";
import type { IpcMainHandle, Implementations } from "electron-effect-rpc/types";

import type { EditorWindowParams } from "@main/editor-window";
import { NodeServicesLive } from "@main/effect/node-services";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import type { AppContract } from "@shared/rpc/contracts";
import { CardEdited } from "@shared/rpc/contracts";
import { EditorOperationError } from "@shared/rpc/schemas/editor";
import {
  CardContentIndexOutOfBoundsError,
  CardContentNotFoundError,
  CardContentParseError,
  CardContentReadError,
  ReviewOperationError,
} from "@shared/rpc/schemas/review";

const APP_NAME = "re Desktop";

const reviewItemTypes = [QAType, ClozeType] as const;

type EditorCardType = "qa" | "cloze";

type DuplicateIndexEntry = {
  readonly deckPath: string;
  readonly cardIds: readonly string[];
};

type DuplicateIndexCache = {
  readonly rootPath: string;
  readonly byKey: Map<string, DuplicateIndexEntry[]>;
};

type AppEventPublisher = IpcMainHandle<AppContract>["publish"];
type OpenEditorWindow = (params: EditorWindowParams) => void;

const noOpPublish = ((..._args: [unknown, unknown]) => Effect.void) as AppEventPublisher;
const noOpOpenEditorWindow: OpenEditorWindow = () => undefined;

const DeckManagerServicesLive = DeckManagerLive.pipe(Layer.provide(NodeServicesLive));
const ReviewQueueBuilderServicesLive = ReviewQueueBuilderLive.pipe(
  Layer.provide(
    Layer.mergeAll(DeckManagerServicesLive, ShuffledOrderingStrategy, NodeServicesLive),
  ),
);

const ReviewServicesLive = Layer.mergeAll(
  SchedulerLive,
  DeckManagerServicesLive,
  ReviewQueueBuilderServicesLive,
);

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toEditorError = (error: unknown): EditorOperationError =>
  new EditorOperationError({ message: toErrorMessage(error) });

const toStringId = (id: string): string => id;

const assertWithinRoot = (deckPath: string, rootPath: string): boolean => {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedDeckPath = path.resolve(deckPath);
  const relativePath = path.relative(resolvedRootPath, resolvedDeckPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const findCardLocationById = (
  parsed: ParsedFile,
  cardId: string,
): { item: Item; card: Item["cards"][number]; itemIndex: number; cardIndex: number } | null => {
  for (let itemIndex = 0; itemIndex < parsed.items.length; itemIndex++) {
    const item = parsed.items[itemIndex]!;
    for (let cardIndex = 0; cardIndex < item.cards.length; cardIndex++) {
      const card = item.cards[cardIndex]!;
      if (card.id === cardId) {
        return { item, card, itemIndex, cardIndex };
      }
    }
  }

  return null;
};

const getConfiguredRootPath = <E>(
  settingsRepository: SettingsRepository,
  mapSettingsError: (error: unknown) => E,
  makeMissingRootError: () => E,
): Effect.Effect<string, E> =>
  settingsRepository.getSettings().pipe(
    Effect.mapError(mapSettingsError),
    Effect.flatMap((settings) => {
      if (settings.workspace.rootPath === null) {
        return Effect.fail(makeMissingRootError());
      }

      return Effect.succeed(settings.workspace.rootPath);
    }),
  );

const validateDeckAccess = <E>(
  settingsRepository: SettingsRepository,
  options: {
    readonly deckPath: string;
    readonly mapSettingsError: (error: unknown) => E;
    readonly makeMissingRootError: () => E;
    readonly makeOutsideRootError: (deckPath: string) => E;
  },
): Effect.Effect<string, E> =>
  getConfiguredRootPath(
    settingsRepository,
    options.mapSettingsError,
    options.makeMissingRootError,
  ).pipe(
    Effect.filterOrFail(
      (configuredRootPath) => assertWithinRoot(options.deckPath, configuredRootPath),
      () => options.makeOutsideRootError(options.deckPath),
    ),
  );

const resolveEditorItemType = (cardType: EditorCardType) => (cardType === "qa" ? QAType : ClozeType);

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

const uniqueClozeIndices = (content: string): Effect.Effect<readonly number[], EditorOperationError> =>
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

const hasCardIdOverlap = (cardIds: readonly string[], excludedIds: ReadonlySet<string>): boolean => {
  for (const cardId of cardIds) {
    if (excludedIds.has(cardId)) {
      return true;
    }
  }
  return false;
};

export type AppRpcHandlers = {
  readonly handlers: Implementations<AppContract>;
  readonly markDuplicateIndexDirty: () => void;
};

export const createAppRpcHandlers = (
  settingsRepository: SettingsRepository,
  watcher: WorkspaceWatcher,
  publish: AppEventPublisher = noOpPublish,
  openEditorWindow: OpenEditorWindow = noOpOpenEditorWindow,
): AppRpcHandlers => {
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

      // Rebuild lazily and retry when an invalidation happened mid-rebuild.
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

  const handlers: Implementations<AppContract> = {
    GetBootstrapData: () =>
      Effect.succeed({
        appName: APP_NAME,
        message: "Renderer connected to main through typed Effect RPC",
        timestamp: new Date().toISOString(),
      }),
    ParseDeckPreview: ({ markdown }) =>
      parseFile(markdown).pipe(
        Effect.map((parsed) => ({
          items: parsed.items.length,
          cards: parsed.items.reduce((total, item) => total + item.cards.length, 0),
        })),
      ),
    ScanDecks: ({ rootPath }) => scanDecks(rootPath).pipe(Effect.provide(NodeServicesLive)),
    GetWorkspaceSnapshot: ({ rootPath, options }) =>
      snapshotWorkspace(rootPath, options).pipe(Effect.provide(NodeServicesLive)),
    GetSettings: () => settingsRepository.getSettings(),
    SetWorkspaceRootPath: (input) =>
      settingsRepository.setWorkspaceRootPath(input).pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            markDuplicateIndexDirty();
            if (settings.workspace.rootPath) {
              watcher.start(settings.workspace.rootPath);
            } else {
              watcher.stop();
            }
          }),
        ),
      ),
    BuildReviewQueue: ({ deckPaths, rootPath }) =>
      Effect.gen(function* () {
        const configuredRootPath = yield* getConfiguredRootPath(
          settingsRepository,
          (error) => new ReviewOperationError({ message: toErrorMessage(error) }),
          () =>
            new ReviewOperationError({
              message: "Workspace root path is not configured.",
            }),
        );
        if (path.resolve(rootPath) !== path.resolve(configuredRootPath)) {
          return yield* Effect.fail(
            new ReviewOperationError({
              message: `Root path mismatch. Expected ${configuredRootPath}, received ${rootPath}.`,
            }),
          );
        }

        for (const deckPath of deckPaths) {
          if (!assertWithinRoot(deckPath, configuredRootPath)) {
            return yield* Effect.fail(
              new ReviewOperationError({
                message: `Deck path is outside workspace root: ${deckPath}`,
              }),
            );
          }
        }

        const queueBuilder = yield* ReviewQueueBuilder;
        const queue = yield* queueBuilder.buildQueue({
          deckPaths,
          rootPath: configuredRootPath,
          now: new Date(),
        });

        return {
          items: queue.items.map((queueItem) => ({
            deckPath: queueItem.deckPath,
            cardId: toStringId(queueItem.card.id),
            cardIndex: queueItem.cardIndex,
            deckName: queueItem.deckName,
          })),
          totalNew: queue.totalNew,
          totalDue: queue.totalDue,
        };
      }).pipe(
        Effect.provide(ReviewServicesLive),
        Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
      ),
    GetCardContent: ({ deckPath, cardId, cardIndex }) =>
      Effect.gen(function* () {
        yield* validateDeckAccess<CardContentReadError | CardContentNotFoundError>(
          settingsRepository,
          {
          deckPath,
          mapSettingsError: (error) => new CardContentReadError({ message: toErrorMessage(error) }),
          makeMissingRootError: () =>
            new CardContentNotFoundError({
              message: "Workspace root path is not configured.",
            }),
          makeOutsideRootError: (invalidDeckPath) =>
            new CardContentNotFoundError({
              message: `Deck path is outside workspace root: ${invalidDeckPath}`,
            }),
          },
        );

        const deckManager = yield* DeckManager;
        const parsed = yield* deckManager.readDeck(deckPath).pipe(
          Effect.catchTags({
            DeckNotFound: (e) => Effect.fail(new CardContentNotFoundError({ message: e.message })),
            DeckReadError: (e) => Effect.fail(new CardContentReadError({ message: e.message })),
            DeckParseError: (e) => Effect.fail(new CardContentParseError({ message: e.message })),
          }),
        );
        const found = findCardLocationById(parsed, cardId);

        if (!found) {
          return yield* Effect.fail(
            new CardContentNotFoundError({
              message: `Card not found: ${cardId}`,
            }),
          );
        }

        const inferred = yield* inferType(reviewItemTypes, found.item.content).pipe(
          Effect.mapError((error) => new CardContentParseError({ message: error.message })),
        );

        const cards = inferred.type.cards(inferred.content);
        const cardSpec = cards[cardIndex];

        if (!cardSpec) {
          return yield* Effect.fail(
            new CardContentIndexOutOfBoundsError({
              cardIndex,
              availableCards: cards.length,
            }),
          );
        }

        if (cardSpec.cardType !== "qa" && cardSpec.cardType !== "cloze") {
          return yield* Effect.fail(
            new CardContentParseError({
              message: `Unsupported card type: ${cardSpec.cardType}`,
            }),
          );
        }

        return {
          prompt: cardSpec.prompt,
          reveal: cardSpec.reveal,
          cardType: cardSpec.cardType as "qa" | "cloze",
        };
      }).pipe(Effect.provide(ReviewServicesLive)),
    ScheduleReview: ({ deckPath, cardId, grade }) =>
      Effect.gen(function* () {
        yield* validateDeckAccess(settingsRepository, {
          deckPath,
          mapSettingsError: (error) => new ReviewOperationError({ message: toErrorMessage(error) }),
          makeMissingRootError: () =>
            new ReviewOperationError({
              message: "Workspace root path is not configured.",
            }),
          makeOutsideRootError: (invalidDeckPath) =>
            new ReviewOperationError({
              message: `Deck path is outside workspace root: ${invalidDeckPath}`,
            }),
        });

        const deckManager = yield* DeckManager;
        const scheduler = yield* Scheduler;

        const parsed = yield* deckManager.readDeck(deckPath);
        const cardLocation = findCardLocationById(parsed, cardId);

        if (!cardLocation) {
          return yield* Effect.fail(
            new ReviewOperationError({
              message: `Card not found: ${cardId}`,
            }),
          );
        }

        const scheduleResult = yield* scheduler.scheduleReview(cardLocation.card, grade, new Date());

        yield* deckManager.updateCardMetadata(deckPath, cardId, scheduleResult.updatedCard);

        return {
          previousCard: cardLocation.card,
        };
      }).pipe(
        Effect.provide(ReviewServicesLive),
        Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
      ),
    UndoReview: ({ deckPath, cardId, previousCard }) =>
      Effect.gen(function* () {
        yield* validateDeckAccess(settingsRepository, {
          deckPath,
          mapSettingsError: (error) => new ReviewOperationError({ message: toErrorMessage(error) }),
          makeMissingRootError: () =>
            new ReviewOperationError({
              message: "Workspace root path is not configured.",
            }),
          makeOutsideRootError: (invalidDeckPath) =>
            new ReviewOperationError({
              message: `Deck path is outside workspace root: ${invalidDeckPath}`,
            }),
        });

        const deckManager = yield* DeckManager;
        yield* deckManager.updateCardMetadata(deckPath, cardId, previousCard);

        return {};
      }).pipe(
        Effect.provide(ReviewServicesLive),
        Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
      ),
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

          mergedMetadata = newIndices.map((index) => metadataByIndex.get(index) ?? createMetadata());
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
      }).pipe(
        Effect.provide(ReviewServicesLive),
        Effect.mapError(toEditorError),
      ),
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
      }).pipe(
        Effect.provide(ReviewServicesLive),
        Effect.mapError(toEditorError),
      ),
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
