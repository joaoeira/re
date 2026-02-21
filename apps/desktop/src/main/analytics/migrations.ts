import * as Migrator from "@effect/sql/Migrator";
import * as SqlClient from "@effect/sql/SqlClient";
import { Effect } from "effect";

const MIGRATION_KEY_PATTERN = /^(\d{4})_[a-z0-9_]+$/;

const REVIEW_HISTORY_MIGRATIONS = {
  "0001_create_review_history": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY,
        canonical_root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS review_history (
        id INTEGER PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
        reviewed_at TEXT NOT NULL,
        deck_relative_path TEXT NOT NULL,
        deck_path TEXT NOT NULL,
        card_id TEXT NOT NULL,
        grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 3),
        previous_state INTEGER NOT NULL,
        next_state INTEGER NOT NULL,
        previous_due TEXT,
        next_due TEXT,
        previous_stability REAL NOT NULL,
        next_stability REAL NOT NULL,
        previous_difficulty REAL NOT NULL,
        next_difficulty REAL NOT NULL,
        previous_learning_steps INTEGER NOT NULL,
        next_learning_steps INTEGER NOT NULL,
        undone_at TEXT
      )
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS review_history_workspace_reviewed_idx
      ON review_history(workspace_id, reviewed_at DESC)
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS review_history_workspace_grade_reviewed_idx
      ON review_history(workspace_id, grade, reviewed_at DESC)
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS review_history_workspace_card_reviewed_idx
      ON review_history(workspace_id, card_id, reviewed_at DESC)
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS review_history_workspace_deck_relative_reviewed_idx
      ON review_history(workspace_id, deck_relative_path, reviewed_at DESC)
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS review_history_active_idx
      ON review_history(workspace_id, reviewed_at DESC)
      WHERE undone_at IS NULL
    `;
  }),
} satisfies Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>;

const toMigrationError = (message: string): Migrator.MigrationError =>
  new Migrator.MigrationError({
    reason: "bad-state",
    message,
  });

const validateMigrationKeys = <
  T extends Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>,
>(
  migrations: T,
): Effect.Effect<T, Migrator.MigrationError> =>
  Effect.gen(function* () {
    const ids = new Set<number>();

    for (const key of Object.keys(migrations)) {
      const match = key.match(MIGRATION_KEY_PATTERN);
      if (!match) {
        return yield* Effect.fail(
          toMigrationError(
            `Invalid migration key "${key}". Expected format "0001_descriptive_name".`,
          ),
        );
      }

      const id = parseInt(match[1]!, 10);
      if (ids.has(id)) {
        return yield* Effect.fail(
          toMigrationError(`Duplicate migration id "${id}" detected in key "${key}".`),
        );
      }

      ids.add(id);
    }

    return migrations;
  });

export const validateReviewAnalyticsMigrationKeys = validateMigrationKeys;

const strictMigrationLoader: Migrator.Loader =
  validateMigrationKeys(REVIEW_HISTORY_MIGRATIONS).pipe(
    Effect.flatMap((migrations) => Migrator.fromRecord(migrations)),
  );

const migrationRunner = Migrator.make({});

export const migrateReviewAnalytics = migrationRunner({
  loader: strictMigrationLoader,
});

export const reviewAnalyticsStartupEffect = Effect.gen(function* () {
  yield* migrateReviewAnalytics;
  const sql = (yield* SqlClient.SqlClient).withoutTransforms();
  yield* sql`SELECT 1 as ok`;
});
