import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import { replayPendingCompensationIntents } from "@main/analytics/replay";
import type { CompensationIntent, ReviewAnalyticsRepository } from "@main/analytics/types";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { toMetadataFingerprint } from "@main/analytics/fingerprint";
import { DeckManager, type DeckManager as DeckManagerService } from "@re/workspace";

const metadata = {
  id: "card-1" as never,
  stability: { value: 0, raw: "0" },
  difficulty: { value: 0, raw: "0" },
  state: 0 as const,
  learningSteps: 0,
  lastReview: null,
  due: null,
};

const makeIntent = (overrides: Partial<CompensationIntent> = {}): CompensationIntent => ({
  intentId: "intent-1",
  reviewEntryId: 1,
  deckPath: "/workspace/deck.md",
  cardId: "card-1",
  expectedCurrentCardFingerprint: "expected-after-schedule",
  previousCardFingerprint: toMetadataFingerprint(metadata),
  createdAt: "2026-01-01T00:00:00.000Z",
  attemptCount: 0,
  status: "pending",
  lastError: null,
  ...overrides,
});

const makeRepository = (overrides: Partial<ReviewAnalyticsRepository> = {}): ReviewAnalyticsRepository => ({
  enabled: true,
  recordSchedule: () => Effect.succeed(null),
  compensateUndo: () => Effect.void,
  persistIntent: () => Effect.void,
  markIntentCompleted: () => Effect.void,
  markIntentConflict: () => Effect.void,
  markIntentPendingFailure: () => Effect.void,
  loadPendingIntents: () => Effect.succeed([]),
  getDiagnostics: () =>
    Effect.succeed({
      pendingIntentCount: 0,
      conflictIntentCount: 0,
      replayAttempts: 0,
      replaySuccess: 0,
      replayFailure: 0,
      droppedScheduleAnalyticsInsertCount: 0,
      intentJournalWriteFailures: 0,
    }),
  getReviewStats: () => Effect.succeed({ total: 0, active: 0, undone: 0 }),
  listReviewHistory: () => Effect.succeed([]),
  noteReplayAttempt: () => Effect.void,
  noteReplaySuccess: () => Effect.void,
  noteReplayFailure: () => Effect.void,
  ...overrides,
});

describe("analytics replay", () => {
  it("applies compensation when rollback is present and marks intent as completed", async () => {
    const compensateUndo = vi.fn(() => Effect.void);
    const markIntentCompleted = vi.fn(() => Effect.void);
    const noteReplayAttempt = vi.fn(() => Effect.void);
    const noteReplaySuccess = vi.fn(() => Effect.void);
    const noteReplayFailure = vi.fn(() => Effect.void);

    const repository = makeRepository({
      loadPendingIntents: () => Effect.succeed([makeIntent()]),
      compensateUndo,
      markIntentCompleted,
      noteReplayAttempt,
      noteReplaySuccess,
      noteReplayFailure,
    });

    const withDeckLock = vi.fn();
    const coordinator: DeckWriteCoordinator = {
      withDeckLock: (deckPath, effect) => {
        withDeckLock(deckPath);
        return effect;
      },
    };

    const deckManager: DeckManagerService = {
      readDeck: () =>
        Effect.succeed({
          preamble: "",
          items: [
            {
              content: "Question\n---\nAnswer\n",
              cards: [metadata],
            },
          ],
        }),
      updateCardMetadata: () => Effect.void,
      replaceItem: () => Effect.void,
      appendItem: () => Effect.void,
      removeItem: () => Effect.void,
    };

    await Effect.runPromise(
      replayPendingCompensationIntents(repository, coordinator).pipe(
        Effect.provide(Layer.succeed(DeckManager, deckManager)),
      ),
    );

    expect(withDeckLock).toHaveBeenCalledTimes(1);
    expect(compensateUndo).toHaveBeenCalledTimes(1);
    expect(markIntentCompleted).toHaveBeenCalledTimes(1);
    expect(noteReplayAttempt).toHaveBeenCalledTimes(1);
    expect(noteReplaySuccess).toHaveBeenCalledTimes(1);
    expect(noteReplayFailure).not.toHaveBeenCalled();
  });

  it("escalates rollback-absent intents to conflict after retry threshold", async () => {
    const markIntentPendingFailure = vi.fn(() => Effect.void);
    const markIntentConflict = vi.fn(() => Effect.void);
    const noteReplayFailure = vi.fn(() => Effect.void);

    const repository = makeRepository({
      loadPendingIntents: () =>
        Effect.succeed([
          makeIntent({
            intentId: "intent-retry",
            reviewEntryId: 99,
            expectedCurrentCardFingerprint: toMetadataFingerprint(metadata),
            previousCardFingerprint: "previous-before-rollback",
            attemptCount: 9,
          }),
        ]),
      markIntentPendingFailure,
      markIntentConflict,
      noteReplayFailure,
    });

    const coordinator: DeckWriteCoordinator = {
      withDeckLock: (_deckPath, effect) => effect,
    };

    const deckManager: DeckManagerService = {
      readDeck: () =>
        Effect.succeed({
          preamble: "",
          items: [{ content: "Q\n---\nA\n", cards: [metadata] }],
        }),
      updateCardMetadata: () => Effect.void,
      replaceItem: () => Effect.void,
      appendItem: () => Effect.void,
      removeItem: () => Effect.void,
    };

    await Effect.runPromise(
      replayPendingCompensationIntents(repository, coordinator).pipe(
        Effect.provide(Layer.succeed(DeckManager, deckManager)),
      ),
    );

    expect(markIntentPendingFailure).not.toHaveBeenCalled();
    expect(markIntentConflict).toHaveBeenCalledTimes(1);
    expect(noteReplayFailure).toHaveBeenCalledTimes(1);
  });
});
