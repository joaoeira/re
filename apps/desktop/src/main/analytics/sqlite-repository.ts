import * as SqlClient from "@effect/sql/SqlClient";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Effect, ManagedRuntime } from "effect";

import { toErrorMessage, toIsoOrNull } from "@main/utils/format";
import { createCompensationIntentJournal } from "./intent-journal";
import { reviewAnalyticsStartupEffect } from "./migrations";
import type {
  AnalyticsDiagnostics,
  CompensationIntent,
  ReviewAnalyticsRepository,
  ReviewHistoryEntry,
  ReviewStats,
  ScheduleAnalyticsInput,
} from "./types";

interface CreateSqliteReviewAnalyticsRepositoryOptions {
  readonly dbPath: string;
  readonly journalPath: string;
}

export interface SqliteReviewAnalyticsRuntimeBundle {
  readonly runtime: ManagedRuntime.ManagedRuntime<
    SqlClient.SqlClient | SqliteClient.SqliteClient,
    unknown
  >;
  readonly startupEffect: Effect.Effect<void, unknown, SqlClient.SqlClient>;
  readonly repository: ReviewAnalyticsRepository;
}

type ReviewHistoryRow = {
  id: number;
  canonical_root_path: string;
  reviewed_at: string;
  deck_relative_path: string;
  deck_path: string;
  card_id: string;
  grade: number;
  previous_state: number;
  next_state: number;
  previous_due: string | null;
  next_due: string | null;
  previous_stability: number;
  next_stability: number;
  previous_difficulty: number;
  next_difficulty: number;
  previous_learning_steps: number;
  next_learning_steps: number;
  undone_at: string | null;
};

const toReviewGrade = (grade: number): 0 | 1 | 2 | 3 =>
  grade === 0 || grade === 1 || grade === 2 || grade === 3 ? grade : 0;

export const createSqliteReviewAnalyticsRuntimeBundle = ({
  dbPath,
  journalPath,
}: CreateSqliteReviewAnalyticsRepositoryOptions): SqliteReviewAnalyticsRuntimeBundle => {
  const analyticsLayer = SqliteClient.layer({
    filename: dbPath,
  });
  const runtime = ManagedRuntime.make(analyticsLayer);
  const journal = createCompensationIntentJournal(journalPath);

  const diagnostics = {
    replayAttempts: 0,
    replaySuccess: 0,
    replayFailure: 0,
    droppedScheduleAnalyticsInsertCount: 0,
    intentJournalWriteFailures: 0,
  };

  const runSql = <A>(
    effect: Effect.Effect<A, unknown, SqlClient.SqlClient>,
  ): Effect.Effect<A, unknown> => Effect.tryPromise(() => runtime.runPromise(effect));

  const ensureWorkspaceId = (
    workspaceCanonicalPath: string,
  ): Effect.Effect<number, unknown, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();

      yield* sql`
        INSERT OR IGNORE INTO workspaces (canonical_root_path)
        VALUES (${workspaceCanonicalPath})
      `;

      const rows = yield* sql<{ id: number }>`
        SELECT id
        FROM workspaces
        WHERE canonical_root_path = ${workspaceCanonicalPath}
        LIMIT 1
      `;

      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(
          new Error(`Failed to resolve workspace id for path: ${workspaceCanonicalPath}`),
        );
      }

      return Number(row.id);
    });

  const recordScheduleSql = (
    input: ScheduleAnalyticsInput,
  ): Effect.Effect<number, unknown, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const workspaceId = yield* ensureWorkspaceId(input.workspaceCanonicalPath);

      yield* sql`
        INSERT INTO review_history
          (
            workspace_id,
            reviewed_at,
            deck_relative_path,
            deck_path,
            card_id,
            grade,
            previous_state,
            next_state,
            previous_due,
            next_due,
            previous_stability,
            next_stability,
            previous_difficulty,
            next_difficulty,
            previous_learning_steps,
            next_learning_steps,
            undone_at
          )
        VALUES
          (
            ${workspaceId},
            ${input.reviewedAt.toISOString()},
            ${input.deckRelativePath},
            ${input.deckPath},
            ${input.cardId},
            ${input.grade},
            ${input.previousState},
            ${input.nextState},
            ${toIsoOrNull(input.previousDue)},
            ${toIsoOrNull(input.nextDue)},
            ${input.previousStability},
            ${input.nextStability},
            ${input.previousDifficulty},
            ${input.nextDifficulty},
            ${input.previousLearningSteps},
            ${input.nextLearningSteps},
            NULL
          )
      `;

      const rows = yield* sql<{ id: number }>`
        SELECT last_insert_rowid() AS id
      `;

      const row = rows[0];
      if (!row) {
        return yield* Effect.fail(new Error("Review insert returned no id."));
      }

      return Number(row.id);
    });

  const compensateUndoSql = (input: {
    readonly reviewEntryId: number;
    readonly undoneAt: Date;
  }): Effect.Effect<void, unknown, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      yield* sql`
        UPDATE review_history
        SET undone_at = ${input.undoneAt.toISOString()}
        WHERE id = ${input.reviewEntryId}
          AND undone_at IS NULL
      `;
    });

  const readStatsSql = (input: {
    readonly workspaceCanonicalPath: string;
    readonly includeUndone: boolean;
  }): Effect.Effect<ReviewStats, unknown, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();

      const activeRows = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM review_history rh
        JOIN workspaces w ON w.id = rh.workspace_id
        WHERE w.canonical_root_path = ${input.workspaceCanonicalPath}
          AND rh.undone_at IS NULL
      `;

      const undoneRows = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM review_history rh
        JOIN workspaces w ON w.id = rh.workspace_id
        WHERE w.canonical_root_path = ${input.workspaceCanonicalPath}
          AND rh.undone_at IS NOT NULL
      `;

      const active = Number(activeRows[0]?.count ?? 0);
      const undone = Number(undoneRows[0]?.count ?? 0);

      return {
        total: input.includeUndone ? active + undone : active,
        active,
        undone: input.includeUndone ? undone : 0,
      };
    });

  const listHistorySql = (input: {
    readonly workspaceCanonicalPath: string;
    readonly includeUndone: boolean;
    readonly limit: number;
    readonly offset: number;
  }): Effect.Effect<readonly ReviewHistoryEntry[], unknown, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* sql<ReviewHistoryRow>`
        SELECT
          rh.id,
          w.canonical_root_path,
          rh.reviewed_at,
          rh.deck_relative_path,
          rh.deck_path,
          rh.card_id,
          rh.grade,
          rh.previous_state,
          rh.next_state,
          rh.previous_due,
          rh.next_due,
          rh.previous_stability,
          rh.next_stability,
          rh.previous_difficulty,
          rh.next_difficulty,
          rh.previous_learning_steps,
          rh.next_learning_steps,
          rh.undone_at
        FROM review_history rh
        JOIN workspaces w ON w.id = rh.workspace_id
        WHERE w.canonical_root_path = ${input.workspaceCanonicalPath}
          AND (${input.includeUndone ? 1 : 0} = 1 OR rh.undone_at IS NULL)
        ORDER BY rh.reviewed_at DESC
        LIMIT ${input.limit}
        OFFSET ${input.offset}
      `;

      return rows.map((row) => {
        return {
          id: Number(row.id),
          workspaceCanonicalPath: row.canonical_root_path,
          reviewedAt: row.reviewed_at,
          deckRelativePath: row.deck_relative_path,
          deckPath: row.deck_path,
          cardId: row.card_id,
          grade: toReviewGrade(Number(row.grade)),
          previousState: Number(row.previous_state),
          nextState: Number(row.next_state),
          previousDue: row.previous_due,
          nextDue: row.next_due,
          previousStability: Number(row.previous_stability),
          nextStability: Number(row.next_stability),
          previousDifficulty: Number(row.previous_difficulty),
          nextDifficulty: Number(row.next_difficulty),
          previousLearningSteps: Number(row.previous_learning_steps),
          nextLearningSteps: Number(row.next_learning_steps),
          undoneAt: row.undone_at,
        };
      });
    });

  const repository: ReviewAnalyticsRepository = {
    enabled: true,
    recordSchedule: (input) =>
      runSql(recordScheduleSql(input)).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            diagnostics.droppedScheduleAnalyticsInsertCount += 1;
            console.error("[desktop/analytics] schedule insert failed", toErrorMessage(error));
            return null;
          }),
        ),
      ),
    compensateUndo: (input) => runSql(compensateUndoSql(input)),
    persistIntent: (intent) =>
      journal.persistPendingIntent(intent).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            diagnostics.intentJournalWriteFailures += 1;
          }),
        ),
      ),
    markIntentCompleted: (intentId) =>
      journal.markCompleted(intentId).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            diagnostics.intentJournalWriteFailures += 1;
            console.error(
              "[desktop/analytics] failed to mark intent completed",
              toErrorMessage(error),
            );
          }),
        ),
      ),
    markIntentConflict: (intentId, message) =>
      journal.markConflict(intentId, message).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            diagnostics.intentJournalWriteFailures += 1;
            console.error(
              "[desktop/analytics] failed to mark intent conflict",
              toErrorMessage(error),
            );
          }),
        ),
      ),
    markIntentPendingFailure: (intentId, message) =>
      journal.markPendingFailure(intentId, message).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            diagnostics.intentJournalWriteFailures += 1;
            console.error(
              "[desktop/analytics] failed to mark intent pending failure",
              toErrorMessage(error),
            );
          }),
        ),
      ),
    loadPendingIntents: () =>
      journal.loadPendingIntents().pipe(
        Effect.catchAll((error) => {
          const message = toErrorMessage(error);
          return Effect.sync(() => {
            diagnostics.intentJournalWriteFailures += 1;
            console.error("[desktop/analytics] failed to load pending intents", message);
            return [] as readonly CompensationIntent[];
          });
        }),
      ),
    getDiagnostics: () =>
      journal.summarize().pipe(
        Effect.map(({ pending, conflict }): AnalyticsDiagnostics => ({
          pendingIntentCount: pending,
          conflictIntentCount: conflict,
          replayAttempts: diagnostics.replayAttempts,
          replaySuccess: diagnostics.replaySuccess,
          replayFailure: diagnostics.replayFailure,
          droppedScheduleAnalyticsInsertCount: diagnostics.droppedScheduleAnalyticsInsertCount,
          intentJournalWriteFailures: diagnostics.intentJournalWriteFailures,
        })),
        Effect.catchAll((error) =>
          Effect.sync((): AnalyticsDiagnostics => {
            diagnostics.intentJournalWriteFailures += 1;
            console.error("[desktop/analytics] failed to compute diagnostics", toErrorMessage(error));
            return {
              pendingIntentCount: 0,
              conflictIntentCount: 0,
              replayAttempts: diagnostics.replayAttempts,
              replaySuccess: diagnostics.replaySuccess,
              replayFailure: diagnostics.replayFailure,
              droppedScheduleAnalyticsInsertCount: diagnostics.droppedScheduleAnalyticsInsertCount,
              intentJournalWriteFailures: diagnostics.intentJournalWriteFailures,
            };
          }),
        ),
      ),
    getReviewStats: (input) =>
      runSql(readStatsSql(input)).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("[desktop/analytics] stats query failed", toErrorMessage(error));
            return {
              total: 0,
              active: 0,
              undone: 0,
            } satisfies ReviewStats;
          }),
        ),
      ),
    listReviewHistory: (input) =>
      runSql(listHistorySql(input)).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("[desktop/analytics] history query failed", toErrorMessage(error));
            return [] as readonly ReviewHistoryEntry[];
          }),
        ),
      ),
    noteReplayAttempt: () =>
      Effect.sync(() => {
        diagnostics.replayAttempts += 1;
      }),
    noteReplaySuccess: () =>
      Effect.sync(() => {
        diagnostics.replaySuccess += 1;
      }),
    noteReplayFailure: () =>
      Effect.sync(() => {
        diagnostics.replayFailure += 1;
      }),
  };

  return {
    runtime,
    startupEffect: reviewAnalyticsStartupEffect,
    repository,
  };
};
