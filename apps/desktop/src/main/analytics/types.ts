import { Effect } from "effect";

export type CompensationIntentStatus = "pending" | "completed" | "conflict";

export interface CompensationIntent {
  readonly intentId: string;
  readonly reviewEntryId: number;
  readonly deckPath: string;
  readonly cardId: string;
  readonly expectedCurrentCardFingerprint: string;
  readonly previousCardFingerprint: string;
  readonly createdAt: string;
  readonly attemptCount: number;
  readonly status: CompensationIntentStatus;
  readonly lastError: string | null;
}

export interface ReviewHistoryEntry {
  readonly id: number;
  readonly workspaceCanonicalPath: string;
  readonly reviewedAt: string;
  readonly deckRelativePath: string;
  readonly deckPath: string;
  readonly cardId: string;
  readonly grade: 0 | 1 | 2 | 3;
  readonly previousState: number;
  readonly nextState: number;
  readonly previousDue: string | null;
  readonly nextDue: string | null;
  readonly previousStability: number;
  readonly nextStability: number;
  readonly previousDifficulty: number;
  readonly nextDifficulty: number;
  readonly previousLearningSteps: number;
  readonly nextLearningSteps: number;
  readonly undoneAt: string | null;
}

export interface ReviewStats {
  readonly total: number;
  readonly active: number;
  readonly undone: number;
}

export interface AnalyticsDiagnostics {
  readonly pendingIntentCount: number;
  readonly conflictIntentCount: number;
  readonly replayAttempts: number;
  readonly replaySuccess: number;
  readonly replayFailure: number;
  readonly droppedScheduleAnalyticsInsertCount: number;
  readonly intentJournalWriteFailures: number;
}

export interface ScheduleAnalyticsInput {
  readonly workspaceCanonicalPath: string;
  readonly deckPath: string;
  readonly deckRelativePath: string;
  readonly cardId: string;
  readonly grade: number;
  readonly previousState: number;
  readonly nextState: number;
  readonly previousDue: Date | null;
  readonly nextDue: Date | null;
  readonly previousStability: number;
  readonly nextStability: number;
  readonly previousDifficulty: number;
  readonly nextDifficulty: number;
  readonly previousLearningSteps: number;
  readonly nextLearningSteps: number;
  readonly reviewedAt: Date;
}

export interface ReviewAnalyticsRepository {
  readonly enabled: boolean;
  readonly recordSchedule: (input: ScheduleAnalyticsInput) => Effect.Effect<number | null, never>;
  readonly compensateUndo: (input: {
    readonly reviewEntryId: number;
    readonly undoneAt: Date;
  }) => Effect.Effect<void, unknown>;
  readonly persistIntent: (intent: CompensationIntent) => Effect.Effect<void, unknown>;
  readonly markIntentCompleted: (intentId: string) => Effect.Effect<void, never>;
  readonly markIntentConflict: (intentId: string, message: string) => Effect.Effect<void, never>;
  readonly markIntentPendingFailure: (intentId: string, message: string) => Effect.Effect<void, never>;
  readonly loadPendingIntents: () => Effect.Effect<readonly CompensationIntent[], never>;
  readonly getDiagnostics: () => Effect.Effect<AnalyticsDiagnostics, never>;
  readonly getReviewStats: (input: {
    readonly workspaceCanonicalPath: string;
    readonly includeUndone: boolean;
  }) => Effect.Effect<ReviewStats, never>;
  readonly listReviewHistory: (input: {
    readonly workspaceCanonicalPath: string;
    readonly includeUndone: boolean;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<readonly ReviewHistoryEntry[], never>;
  readonly noteReplayAttempt: () => Effect.Effect<void, never>;
  readonly noteReplaySuccess: () => Effect.Effect<void, never>;
  readonly noteReplayFailure: () => Effect.Effect<void, never>;
}
