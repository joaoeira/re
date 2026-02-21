import { Effect } from "effect";

import type {
  AnalyticsDiagnostics,
  CompensationIntent,
  ReviewAnalyticsRepository,
  ReviewHistoryEntry,
  ReviewStats,
} from "./types";

const EMPTY_STATS: ReviewStats = {
  total: 0,
  active: 0,
  undone: 0,
};

const EMPTY_DIAGNOSTICS: AnalyticsDiagnostics = {
  pendingIntentCount: 0,
  conflictIntentCount: 0,
  replayAttempts: 0,
  replaySuccess: 0,
  replayFailure: 0,
  droppedScheduleAnalyticsInsertCount: 0,
  intentJournalWriteFailures: 0,
};

export const createNoopReviewAnalyticsRepository = (): ReviewAnalyticsRepository => ({
  enabled: false,
  recordSchedule: () => Effect.succeed(null),
  compensateUndo: () => Effect.void,
  persistIntent: (_intent: CompensationIntent) => Effect.void,
  markIntentCompleted: () => Effect.void,
  markIntentConflict: () => Effect.void,
  markIntentPendingFailure: () => Effect.void,
  loadPendingIntents: () => Effect.succeed([]),
  getDiagnostics: () => Effect.succeed(EMPTY_DIAGNOSTICS),
  getReviewStats: () => Effect.succeed(EMPTY_STATS),
  listReviewHistory: () => Effect.succeed([] as readonly ReviewHistoryEntry[]),
  noteReplayAttempt: () => Effect.void,
  noteReplaySuccess: () => Effect.void,
  noteReplayFailure: () => Effect.void,
});
