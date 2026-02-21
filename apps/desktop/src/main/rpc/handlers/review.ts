import { inferType } from "@re/core";
import { ClozeType, QAType } from "@re/types";
import { DeckManager, ReviewQueueBuilder, Scheduler } from "@re/workspace";
import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import type { SettingsRepository } from "@main/settings/repository";
import type { AppContract } from "@shared/rpc/contracts";
import {
  CardContentIndexOutOfBoundsError,
  CardContentNotFoundError,
  CardContentParseError,
  CardContentReadError,
  ReviewOperationError,
} from "@shared/rpc/schemas/review";

import {
  ReviewServicesLive,
  assertWithinRoot,
  findCardLocationById,
  getConfiguredRootPath,
  toErrorMessage,
  toStringId,
  validateDeckAccess,
} from "./shared";

import path from "node:path";

const reviewItemTypes = [QAType, ClozeType] as const;

type ReviewHandlerKeys =
  | "BuildReviewQueue"
  | "GetCardContent"
  | "ScheduleReview"
  | "UndoReview";

export const createReviewHandlers = (
  settingsRepository: SettingsRepository,
): Pick<Implementations<AppContract>, ReviewHandlerKeys> => ({
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
});
