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
  "0002_create_forge_sessions": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      CREATE TABLE IF NOT EXISTS forge_sessions (
        id INTEGER PRIMARY KEY,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('pdf', 'web')),
        source_file_path TEXT NOT NULL,
        deck_path TEXT,
        source_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created' CHECK (
          status IN (
            'created',
            'extracting',
            'extracted',
            'topics_extracting',
            'topics_extracted',
            'generating',
            'ready',
            'error'
          )
        ),
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_sessions_created_idx
      ON forge_sessions(created_at DESC)
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_sessions_status_idx
      ON forge_sessions(status)
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_sessions_source_kind_fingerprint_idx
      ON forge_sessions(source_kind, source_fingerprint)
    `;
  }),
  "0003_create_forge_chunks": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      CREATE TABLE IF NOT EXISTS forge_chunks (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES forge_sessions(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        sequence_order INTEGER NOT NULL CHECK (sequence_order >= 0),
        page_boundaries TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;

    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS forge_chunks_session_sequence_idx
      ON forge_chunks(session_id, sequence_order)
    `;
  }),
  "0004_create_forge_topics": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      CREATE TABLE IF NOT EXISTS forge_topics (
        id INTEGER PRIMARY KEY,
        chunk_id INTEGER NOT NULL REFERENCES forge_chunks(id) ON DELETE CASCADE,
        topic_order INTEGER NOT NULL CHECK (topic_order >= 0),
        topic_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;

    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS forge_topics_chunk_order_idx
      ON forge_topics(chunk_id, topic_order)
    `;
  }),
  "0005_create_forge_sessions_source_path_idx": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_sessions_source_kind_file_path_created_idx
      ON forge_sessions(source_kind, source_file_path, created_at DESC, id DESC)
    `;
  }),
  "0006_create_forge_cards_domain": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      CREATE TABLE IF NOT EXISTS forge_topic_generation (
        id INTEGER PRIMARY KEY,
        topic_id INTEGER NOT NULL REFERENCES forge_topics(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('idle', 'generating', 'generated', 'error')),
        error_message TEXT,
        generation_started_at TEXT,
        status_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        generation_revision INTEGER NOT NULL DEFAULT 0,
        UNIQUE(topic_id)
      )
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS forge_cards (
        id INTEGER PRIMARY KEY,
        topic_id INTEGER NOT NULL REFERENCES forge_topics(id) ON DELETE CASCADE,
        card_order INTEGER NOT NULL CHECK (card_order >= 0),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(topic_id, card_order)
      )
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_cards_topic_order_idx
      ON forge_cards(topic_id, card_order)
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS forge_card_permutations (
        id INTEGER PRIMARY KEY,
        source_card_id INTEGER NOT NULL REFERENCES forge_cards(id) ON DELETE CASCADE,
        permutation_order INTEGER NOT NULL CHECK (permutation_order >= 0),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE(source_card_id, permutation_order)
      )
    `;

    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_card_permutations_source_order_idx
      ON forge_card_permutations(source_card_id, permutation_order)
    `;

    yield* sql`
      CREATE TABLE IF NOT EXISTS forge_card_cloze (
        id INTEGER PRIMARY KEY,
        source_card_id INTEGER NOT NULL UNIQUE REFERENCES forge_cards(id) ON DELETE CASCADE,
        cloze_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;
  }),
  "0007_add_forge_topics_selected": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      ALTER TABLE forge_topics ADD COLUMN selected INTEGER NOT NULL DEFAULT 0
    `;

    yield* sql`
      UPDATE forge_topics SET selected = 1
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

const strictMigrationLoader: Migrator.Loader = validateMigrationKeys(
  REVIEW_HISTORY_MIGRATIONS,
).pipe(Effect.flatMap((migrations) => Migrator.fromRecord(migrations)));

const migrationRunner = Migrator.make({});

export const migrateReviewAnalytics = migrationRunner({
  loader: strictMigrationLoader,
});

export const reviewAnalyticsStartupEffect = Effect.gen(function* () {
  yield* migrateReviewAnalytics;
  const sql = (yield* SqlClient.SqlClient).withoutTransforms();
  yield* sql`SELECT 1 as ok`;
});
