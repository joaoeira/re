import { DeckManager } from "@re/workspace";
import type { DeckManager as DeckManagerService } from "@re/workspace";
import { Either, Effect, Exit } from "effect";

import { findCardLocationById } from "@main/card-location";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { toErrorMessage } from "@main/utils/format";
import { toMetadataFingerprint } from "./fingerprint";

import type { ReviewAnalyticsRepository } from "./types";

const rollbackAbsentMessage = "Rollback not observed in markdown yet. Compensation kept pending.";
const MAX_ROLLBACK_ABSENT_RETRIES = 10;

type FingerprintReadResult =
  | { readonly ok: true; readonly fingerprint: string | null }
  | { readonly ok: false; readonly message: string };

export const replayPendingCompensationIntents = (
  analyticsRepository: ReviewAnalyticsRepository,
  deckWriteCoordinator: DeckWriteCoordinator,
): Effect.Effect<void, never, DeckManagerService> =>
  Effect.gen(function* () {
    if (!analyticsRepository.enabled) {
      return;
    }

    const deckManager = yield* DeckManager;
    const intents = yield* analyticsRepository.loadPendingIntents();

    for (const intent of intents) {
      yield* analyticsRepository.noteReplayAttempt();

      const currentFingerprintResult = yield* deckWriteCoordinator.withDeckLock(
        intent.deckPath,
        Effect.gen(function* () {
          const parsed = yield* deckManager.readDeck(intent.deckPath);
          const located = findCardLocationById(parsed, intent.cardId);
          if (!located) {
            return null;
          }
          return toMetadataFingerprint(located.card);
        }).pipe(
          Effect.either,
          Effect.map(
            (result): FingerprintReadResult =>
              Either.isLeft(result)
                ? { ok: false as const, message: toErrorMessage(result.left) }
                : { ok: true as const, fingerprint: result.right },
          ),
        ),
      );

      if (currentFingerprintResult.ok === false) {
        yield* analyticsRepository.noteReplayFailure();
        yield* analyticsRepository.markIntentPendingFailure(intent.intentId, currentFingerprintResult.message);
        continue;
      }

      const currentFingerprint = currentFingerprintResult.fingerprint;
      if (currentFingerprint === null) {
        yield* analyticsRepository.noteReplayFailure();
        yield* analyticsRepository.markIntentConflict(
          intent.intentId,
          `Card not found during replay: ${intent.cardId}`,
        );
        continue;
      }

      if (currentFingerprint === intent.previousCardFingerprint) {
        const compensationExit = yield* Effect.exit(
          analyticsRepository.compensateUndo({
            reviewEntryId: intent.reviewEntryId,
            undoneAt: new Date(),
          }),
        );

        if (Exit.isSuccess(compensationExit)) {
          yield* analyticsRepository.noteReplaySuccess();
          yield* analyticsRepository.markIntentCompleted(intent.intentId);
        } else {
          yield* analyticsRepository.noteReplayFailure();
          yield* analyticsRepository.markIntentPendingFailure(
            intent.intentId,
            toErrorMessage(compensationExit.cause),
          );
        }

        continue;
      }

      if (currentFingerprint === intent.expectedCurrentCardFingerprint) {
        yield* analyticsRepository.noteReplayFailure();
        if (intent.attemptCount + 1 >= MAX_ROLLBACK_ABSENT_RETRIES) {
          yield* analyticsRepository.markIntentConflict(intent.intentId, rollbackAbsentMessage);
        } else {
          yield* analyticsRepository.markIntentPendingFailure(intent.intentId, rollbackAbsentMessage);
        }
        continue;
      }

      yield* analyticsRepository.noteReplayFailure();
      yield* analyticsRepository.markIntentConflict(
        intent.intentId,
        `Current fingerprint does not match expected values for ${intent.deckPath}:${intent.cardId}.`,
      );
    }
  });
