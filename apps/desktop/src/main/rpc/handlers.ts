import path from "node:path";

import { inferType, parseFile, type Item, type ParsedFile } from "@re/core";
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
import { Effect, Layer } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { NodeServicesLive } from "@main/effect/node-services";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import type { AppContract } from "@shared/rpc/contracts";
import {
  CardContentIndexOutOfBoundsError,
  CardContentNotFoundError,
  CardContentParseError,
  CardContentReadError,
  ReviewOperationError,
} from "@shared/rpc/schemas/review";

const APP_NAME = "re Desktop";

const reviewItemTypes = [QAType, ClozeType] as const;

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

const assertWithinRoot = (deckPath: string, rootPath: string): boolean => {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedDeckPath = path.resolve(deckPath);
  const relativePath = path.relative(resolvedRootPath, resolvedDeckPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const findCardLocationById = (
  parsed: ParsedFile,
  cardId: string,
): { item: Item; card: Item["cards"][number] } | null => {
  for (const item of parsed.items) {
    for (const card of item.cards) {
      if (card.id === cardId) {
        return { item, card };
      }
    }
  }

  return null;
};

const getConfiguredRootPath = (
  settingsRepository: SettingsRepository,
): Effect.Effect<string, ReviewOperationError> =>
  settingsRepository.getSettings().pipe(
    Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
    Effect.flatMap((settings) => {
      if (settings.workspace.rootPath === null) {
        return Effect.fail(
          new ReviewOperationError({
            message: "Workspace root path is not configured.",
          }),
        );
      }

      return Effect.succeed(settings.workspace.rootPath);
    }),
  );

export const createAppRpcHandlers = (
  settingsRepository: SettingsRepository,
  watcher: WorkspaceWatcher,
): Implementations<AppContract> => ({
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
      const configuredRootPath = yield* getConfiguredRootPath(settingsRepository);
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
          cardId: queueItem.card.id as string,
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
      const configuredRootPath = yield* settingsRepository.getSettings().pipe(
        Effect.mapError((e) => new CardContentReadError({ message: toErrorMessage(e) })),
        Effect.flatMap((settings) => {
          if (settings.workspace.rootPath === null) {
            return Effect.fail(
              new CardContentNotFoundError({
                message: "Workspace root path is not configured.",
              }),
            );
          }

          return Effect.succeed(settings.workspace.rootPath);
        }),
      );

      if (!assertWithinRoot(deckPath, configuredRootPath)) {
        return yield* Effect.fail(
          new CardContentNotFoundError({
            message: `Deck path is outside workspace root: ${deckPath}`,
          }),
        );
      }

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
      const configuredRootPath = yield* getConfiguredRootPath(settingsRepository);
      if (!assertWithinRoot(deckPath, configuredRootPath)) {
        return yield* Effect.fail(
          new ReviewOperationError({
            message: `Deck path is outside workspace root: ${deckPath}`,
          }),
        );
      }

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
      const configuredRootPath = yield* getConfiguredRootPath(settingsRepository);
      if (!assertWithinRoot(deckPath, configuredRootPath)) {
        return yield* Effect.fail(
          new ReviewOperationError({
            message: `Deck path is outside workspace root: ${deckPath}`,
          }),
        );
      }

      const deckManager = yield* DeckManager;
      yield* deckManager.updateCardMetadata(deckPath, cardId, previousCard);

      return {};
    }).pipe(
      Effect.provide(ReviewServicesLive),
      Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
    ),
});
