import path from "node:path";
import { randomUUID } from "node:crypto";

import { inferType } from "@re/core";
import { ClozeType, QAType } from "@re/types";
import { DeckManager, ReviewQueueBuilder, Scheduler, computeDueDate } from "@re/workspace";
import { Effect, Exit } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import type { ReviewAnalyticsRepository } from "@main/analytics";
import { toMetadataFingerprint } from "@main/analytics/fingerprint";
import { findCardLocationById } from "@main/card-location";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import type { SettingsRepository } from "@main/settings/repository";
import { toErrorMessage } from "@main/utils/format";
import type { AppContract } from "@shared/rpc/contracts";
import {
  CardContentIndexOutOfBoundsError,
  CardContentNotFoundError,
  CardContentParseError,
  CardContentReadError,
  ReviewOperationError,
  UndoConflictError,
  UndoSafetyUnavailableError,
} from "@shared/rpc/schemas/review";

import {
  ReviewServicesLive,
  assertWithinRoot,
  canonicalizeWorkspacePath,
  validateDeckAccess,
  validateRequestedRootPath,
} from "./shared";

const reviewItemTypes = [QAType, ClozeType] as const;

type ReviewHandlerKeys =
  | "BuildReviewQueue"
  | "GetCardContent"
  | "ScheduleReview"
  | "UndoReview"
  | "GetReviewStats"
  | "ListReviewHistory";

const toReviewOperationError = (error: unknown): ReviewOperationError =>
  new ReviewOperationError({ message: toErrorMessage(error) });

const failWithReviewOperationError = (error: unknown) =>
  Effect.fail(new ReviewOperationError({ message: toErrorMessage(error) }));

export const createReviewHandlers = (
  settingsRepository: SettingsRepository,
  analyticsRepository: ReviewAnalyticsRepository,
  deckWriteCoordinator: DeckWriteCoordinator,
): Pick<Implementations<AppContract>, ReviewHandlerKeys> => ({
  BuildReviewQueue: ({ deckPaths, rootPath }) =>
    Effect.gen(function* () {
      const configuredRootPath = yield* validateRequestedRootPath(
        settingsRepository,
        {
          requestedRootPath: rootPath,
          mapSettingsError: toReviewOperationError,
          makeMissingRootError: () =>
            new ReviewOperationError({
              message: "Workspace root path is not configured.",
            }),
          makeRootMismatchError: (configured, requested) =>
            new ReviewOperationError({
              message: `Root path mismatch. Expected ${configured}, received ${requested}.`,
            }),
        },
      );

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
          cardId: queueItem.card.id,
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
      const configuredRootPath = yield* validateDeckAccess(settingsRepository, {
        deckPath,
        mapSettingsError: toReviewOperationError,
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

      const reviewedAt = new Date();

      const scheduleResult = yield* deckWriteCoordinator.withDeckLock(
        deckPath,
        Effect.gen(function* () {
          const parsed = yield* deckManager.readDeck(deckPath).pipe(
            Effect.catchTags({
              DeckNotFound: failWithReviewOperationError,
              DeckReadError: failWithReviewOperationError,
              DeckParseError: failWithReviewOperationError,
            }),
          );
          const cardLocation = findCardLocationById(parsed, cardId);

          if (!cardLocation) {
            return yield* Effect.fail(
              new ReviewOperationError({
                message: `Card not found: ${cardId}`,
              }),
            );
          }

          const scheduled = yield* scheduler
            .scheduleReview(cardLocation.card, grade, reviewedAt)
            .pipe(Effect.mapError((error) => new ReviewOperationError({ message: error.message })));

          yield* deckManager
            .updateCardMetadata(deckPath, cardId, scheduled.updatedCard)
            .pipe(
              Effect.catchTags({
                DeckNotFound: failWithReviewOperationError,
                DeckReadError: failWithReviewOperationError,
                DeckParseError: failWithReviewOperationError,
                DeckWriteError: failWithReviewOperationError,
                CardNotFound: failWithReviewOperationError,
              }),
            );

          return {
            previousCard: cardLocation.card,
            previousDue: cardLocation.card.due ?? computeDueDate(cardLocation.card),
            nextCard: scheduled.updatedCard,
            expectedCurrentCardFingerprint: toMetadataFingerprint(scheduled.updatedCard),
            previousCardFingerprint: toMetadataFingerprint(cardLocation.card),
            grade,
            previousState: scheduled.schedulerLog.previousState,
            nextState: scheduled.updatedCard.state,
            previousStability: cardLocation.card.stability.value,
            nextStability: scheduled.updatedCard.stability.value,
            previousDifficulty: cardLocation.card.difficulty.value,
            nextDifficulty: scheduled.updatedCard.difficulty.value,
            previousLearningSteps: cardLocation.card.learningSteps,
            nextLearningSteps: scheduled.updatedCard.learningSteps,
          };
        }),
      );

      const canonicalWorkspacePath = yield* canonicalizeWorkspacePath(configuredRootPath).pipe(
        Effect.catchAll(() => Effect.succeed(configuredRootPath)),
      );
      const deckRelativePath = path.relative(configuredRootPath, deckPath);
      const reviewEntryId = yield* analyticsRepository.recordSchedule({
        workspaceCanonicalPath: canonicalWorkspacePath,
        deckPath,
        deckRelativePath,
        cardId,
        grade: scheduleResult.grade,
        previousState: scheduleResult.previousState,
        nextState: scheduleResult.nextState,
        previousDue: scheduleResult.previousDue,
        nextDue: scheduleResult.nextCard.due,
        previousStability: scheduleResult.previousStability,
        nextStability: scheduleResult.nextStability,
        previousDifficulty: scheduleResult.previousDifficulty,
        nextDifficulty: scheduleResult.nextDifficulty,
        previousLearningSteps: scheduleResult.previousLearningSteps,
        nextLearningSteps: scheduleResult.nextLearningSteps,
        reviewedAt,
      });

      return {
        reviewEntryId,
        expectedCurrentCardFingerprint: scheduleResult.expectedCurrentCardFingerprint,
        previousCardFingerprint: scheduleResult.previousCardFingerprint,
        previousCard: scheduleResult.previousCard,
      };
    }).pipe(
      Effect.provide(ReviewServicesLive),
      Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
    ),
  UndoReview: ({
    deckPath,
    cardId,
    previousCard,
    reviewEntryId,
    expectedCurrentCardFingerprint,
    previousCardFingerprint,
  }) =>
    Effect.gen(function* () {
      yield* validateDeckAccess(settingsRepository, {
        deckPath,
        mapSettingsError: toReviewOperationError,
        makeMissingRootError: () =>
          new ReviewOperationError({
            message: "Workspace root path is not configured.",
          }),
        makeOutsideRootError: (invalidDeckPath) =>
          new ReviewOperationError({
            message: `Deck path is outside workspace root: ${invalidDeckPath}`,
          }),
      });

      const intent =
        reviewEntryId === null
          ? null
          : ({
              intentId: randomUUID(),
              reviewEntryId,
              deckPath,
              cardId,
              expectedCurrentCardFingerprint,
              previousCardFingerprint,
              createdAt: new Date().toISOString(),
              attemptCount: 0,
              status: "pending" as const,
              lastError: null,
            } as const);

      if (intent !== null) {
        yield* analyticsRepository
          .persistIntent(intent)
          .pipe(
            Effect.mapError(
              (error) =>
                new UndoSafetyUnavailableError({
                  message: `Failed to persist undo safety intent: ${toErrorMessage(error)}`,
                }),
            ),
          );
      }

      const deckManager = yield* DeckManager;

      yield* deckWriteCoordinator
        .withDeckLock(
          deckPath,
          Effect.gen(function* () {
            const parsed = yield* deckManager.readDeck(deckPath).pipe(
              Effect.catchTags({
                DeckNotFound: failWithReviewOperationError,
                DeckReadError: failWithReviewOperationError,
                DeckParseError: failWithReviewOperationError,
              }),
            );
            const cardLocation = findCardLocationById(parsed, cardId);

            if (!cardLocation) {
              return yield* Effect.fail(
                new ReviewOperationError({
                  message: `Card not found: ${cardId}`,
                }),
              );
            }

            const actualCurrentCardFingerprint = toMetadataFingerprint(cardLocation.card);
            if (actualCurrentCardFingerprint !== expectedCurrentCardFingerprint) {
              return yield* Effect.fail(
                new UndoConflictError({
                  deckPath,
                  cardId,
                  message:
                    "Undo conflict detected. Card metadata changed outside this review session.",
                  expectedCurrentCardFingerprint,
                  actualCurrentCardFingerprint,
                }),
              );
            }

            yield* deckManager.updateCardMetadata(deckPath, cardId, previousCard).pipe(
              Effect.catchTags({
                DeckNotFound: failWithReviewOperationError,
                DeckReadError: failWithReviewOperationError,
                DeckParseError: failWithReviewOperationError,
                DeckWriteError: failWithReviewOperationError,
                CardNotFound: failWithReviewOperationError,
              }),
            );
          }),
        )
        .pipe(
          Effect.catchTag("undo_conflict", (error) =>
            (intent === null
              ? Effect.fail(error)
              : analyticsRepository
                  .markIntentConflict(intent.intentId, error.message)
                  .pipe(Effect.zipRight(Effect.fail(error)))),
          ),
        );

      if (intent !== null) {
        const compensationExit = yield* Effect.exit(
          analyticsRepository.compensateUndo({
            reviewEntryId: intent.reviewEntryId,
            undoneAt: new Date(),
          }),
        );

        if (Exit.isSuccess(compensationExit)) {
          yield* analyticsRepository.markIntentCompleted(intent.intentId);
        } else {
          yield* analyticsRepository.markIntentPendingFailure(
            intent.intentId,
            toErrorMessage(compensationExit.cause),
          );
        }
      }

      return {};
    }).pipe(Effect.provide(ReviewServicesLive)),
  GetReviewStats: ({ rootPath, includeUndone }) =>
    Effect.gen(function* () {
      const configuredRootPath = yield* validateRequestedRootPath(
        settingsRepository,
        {
          requestedRootPath: rootPath,
          mapSettingsError: toReviewOperationError,
          makeMissingRootError: () =>
            new ReviewOperationError({
              message: "Workspace root path is not configured.",
            }),
          makeRootMismatchError: (configured, requested) =>
            new ReviewOperationError({
              message: `Root path mismatch. Expected ${configured}, received ${requested}.`,
            }),
        },
      );

      const workspaceCanonicalPath = yield* canonicalizeWorkspacePath(configuredRootPath).pipe(
        Effect.mapError((error) =>
          new ReviewOperationError({
            message: `Unable to canonicalize workspace path: ${toErrorMessage(error)}`,
          }),
        ),
      );

      return yield* analyticsRepository.getReviewStats({
        workspaceCanonicalPath,
        includeUndone: includeUndone ?? false,
      });
    }).pipe(
      Effect.provide(ReviewServicesLive),
      Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
    ),
  ListReviewHistory: ({ rootPath, includeUndone, limit, offset }) =>
    Effect.gen(function* () {
      const configuredRootPath = yield* validateRequestedRootPath(
        settingsRepository,
        {
          requestedRootPath: rootPath,
          mapSettingsError: toReviewOperationError,
          makeMissingRootError: () =>
            new ReviewOperationError({
              message: "Workspace root path is not configured.",
            }),
          makeRootMismatchError: (configured, requested) =>
            new ReviewOperationError({
              message: `Root path mismatch. Expected ${configured}, received ${requested}.`,
            }),
        },
      );

      const workspaceCanonicalPath = yield* canonicalizeWorkspacePath(configuredRootPath).pipe(
        Effect.mapError((error) =>
          new ReviewOperationError({
            message: `Unable to canonicalize workspace path: ${toErrorMessage(error)}`,
          }),
        ),
      );

      const normalizedLimit = Math.max(1, Math.min(500, limit ?? 100));
      const normalizedOffset = Math.max(0, offset ?? 0);

      const entries = yield* analyticsRepository.listReviewHistory({
        workspaceCanonicalPath,
        includeUndone: includeUndone ?? false,
        limit: normalizedLimit,
        offset: normalizedOffset,
      });

      return { entries };
    }).pipe(
      Effect.provide(ReviewServicesLive),
      Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) })),
    ),
});
