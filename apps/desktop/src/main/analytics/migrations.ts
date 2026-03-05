import path from "node:path";

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
  "0008_add_forge_cards_added_to_deck_at": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      ALTER TABLE forge_cards ADD COLUMN added_to_deck_at TEXT
    `;
  }),
  "0009_add_forge_card_cloze_added_count": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      ALTER TABLE forge_card_cloze ADD COLUMN added_count INTEGER NOT NULL DEFAULT 0
    `;
  }),
  "0010_add_forge_card_permutations_added_count": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();

    yield* sql`
      ALTER TABLE forge_card_permutations ADD COLUMN added_count INTEGER NOT NULL DEFAULT 0
    `;
  }),
  "0011_generalize_forge_session_sources": Effect.gen(function* () {
    const sql = (yield* SqlClient.SqlClient).withoutTransforms();
    const webRows = yield* sql<{ count: number }>`
      SELECT COUNT(*) AS count
      FROM forge_sessions
      WHERE source_kind = 'web'
    `;

    const webCount = Number(webRows[0]?.count ?? 0);
    if (webCount > 0) {
      return yield* Effect.fail(
        new Error(`Cannot migrate forge_sessions with ${webCount} legacy web source row(s).`),
      );
    }

    yield* sql`DROP TABLE IF EXISTS temp.forge_card_cloze_backup`;
    yield* sql`DROP TABLE IF EXISTS temp.forge_card_permutations_backup`;
    yield* sql`DROP TABLE IF EXISTS temp.forge_cards_backup`;
    yield* sql`DROP TABLE IF EXISTS temp.forge_topic_generation_backup`;
    yield* sql`DROP TABLE IF EXISTS temp.forge_topics_backup`;
    yield* sql`DROP TABLE IF EXISTS temp.forge_chunks_backup`;
    yield* sql`DROP TABLE IF EXISTS temp.forge_sessions_backup`;

    yield* sql`
      CREATE TEMP TABLE forge_sessions_backup AS
      SELECT
        id,
        source_kind,
        source_file_path,
        deck_path,
        source_fingerprint,
        status,
        error_message,
        created_at,
        updated_at
      FROM forge_sessions
    `;
    yield* sql`
      CREATE TEMP TABLE forge_chunks_backup AS
      SELECT
        id,
        session_id,
        text,
        sequence_order,
        page_boundaries,
        created_at
      FROM forge_chunks
    `;
    yield* sql`
      CREATE TEMP TABLE forge_topics_backup AS
      SELECT
        id,
        chunk_id,
        topic_order,
        topic_text,
        created_at,
        selected
      FROM forge_topics
    `;
    yield* sql`
      CREATE TEMP TABLE forge_topic_generation_backup AS
      SELECT
        id,
        topic_id,
        status,
        error_message,
        generation_started_at,
        status_changed_at,
        generation_revision
      FROM forge_topic_generation
    `;
    yield* sql`
      CREATE TEMP TABLE forge_cards_backup AS
      SELECT
        id,
        topic_id,
        card_order,
        question,
        answer,
        created_at,
        added_to_deck_at
      FROM forge_cards
    `;
    yield* sql`
      CREATE TEMP TABLE forge_card_permutations_backup AS
      SELECT
        id,
        source_card_id,
        permutation_order,
        question,
        answer,
        created_at,
        added_count
      FROM forge_card_permutations
    `;
    yield* sql`
      CREATE TEMP TABLE forge_card_cloze_backup AS
      SELECT
        id,
        source_card_id,
        cloze_text,
        created_at,
        updated_at,
        added_count
      FROM forge_card_cloze
    `;

    const sessionRows = yield* sql<{
      id: number;
      source_kind: string;
      source_file_path: string | null;
      deck_path: string | null;
      source_fingerprint: string;
      status: string;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>`
      SELECT
        id,
        source_kind,
        source_file_path,
        deck_path,
        source_fingerprint,
        status,
        error_message,
        created_at,
        updated_at
      FROM forge_sessions_backup
      ORDER BY id ASC
    `;

    yield* sql`DROP TABLE forge_card_cloze`;
    yield* sql`DROP TABLE forge_card_permutations`;
    yield* sql`DROP TABLE forge_cards`;
    yield* sql`DROP TABLE forge_topic_generation`;
    yield* sql`DROP TABLE forge_topics`;
    yield* sql`DROP TABLE forge_chunks`;
    yield* sql`DROP TABLE forge_sessions`;

    yield* sql`
      CREATE TABLE forge_sessions (
        id INTEGER PRIMARY KEY,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('pdf', 'text')),
        source_label TEXT NOT NULL,
        source_file_path TEXT,
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
      CREATE TABLE forge_chunks (
        id INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES forge_sessions(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        sequence_order INTEGER NOT NULL CHECK (sequence_order >= 0),
        page_boundaries TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )
    `;
    yield* sql`
      CREATE TABLE forge_topics (
        id INTEGER PRIMARY KEY,
        chunk_id INTEGER NOT NULL REFERENCES forge_chunks(id) ON DELETE CASCADE,
        topic_order INTEGER NOT NULL CHECK (topic_order >= 0),
        topic_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        selected INTEGER NOT NULL DEFAULT 0
      )
    `;
    yield* sql`
      CREATE TABLE forge_topic_generation (
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
      CREATE TABLE forge_cards (
        id INTEGER PRIMARY KEY,
        topic_id INTEGER NOT NULL REFERENCES forge_topics(id) ON DELETE CASCADE,
        card_order INTEGER NOT NULL CHECK (card_order >= 0),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        added_to_deck_at TEXT,
        UNIQUE(topic_id, card_order)
      )
    `;
    yield* sql`
      CREATE TABLE forge_card_permutations (
        id INTEGER PRIMARY KEY,
        source_card_id INTEGER NOT NULL REFERENCES forge_cards(id) ON DELETE CASCADE,
        permutation_order INTEGER NOT NULL CHECK (permutation_order >= 0),
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        added_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_card_id, permutation_order)
      )
    `;
    yield* sql`
      CREATE TABLE forge_card_cloze (
        id INTEGER PRIMARY KEY,
        source_card_id INTEGER NOT NULL UNIQUE REFERENCES forge_cards(id) ON DELETE CASCADE,
        cloze_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        added_count INTEGER NOT NULL DEFAULT 0
      )
    `;

    yield* Effect.forEach(
      sessionRows,
      (row) => {
        const sourceFilePath = row.source_file_path;
        if (typeof sourceFilePath !== "string" || sourceFilePath.length === 0) {
          return Effect.fail(
            new Error(`Cannot backfill source_label for forge session ${row.id}.`),
          );
        }

        const sourceLabel = path.basename(sourceFilePath) || sourceFilePath;

        return sql`
          INSERT INTO forge_sessions (
            id,
            source_kind,
            source_label,
            source_file_path,
            deck_path,
            source_fingerprint,
            status,
            error_message,
            created_at,
            updated_at
          ) VALUES (
            ${row.id},
            ${row.source_kind},
            ${sourceLabel},
            ${sourceFilePath},
            ${row.deck_path},
            ${row.source_fingerprint},
            ${row.status},
            ${row.error_message},
            ${row.created_at},
            ${row.updated_at}
          )
        `;
      },
      { discard: true },
    );
    yield* sql`
      INSERT INTO forge_chunks (
        id,
        session_id,
        text,
        sequence_order,
        page_boundaries,
        created_at
      )
      SELECT
        id,
        session_id,
        text,
        sequence_order,
        page_boundaries,
        created_at
      FROM forge_chunks_backup
      ORDER BY id ASC
    `;
    yield* sql`
      INSERT INTO forge_topics (
        id,
        chunk_id,
        topic_order,
        topic_text,
        created_at,
        selected
      )
      SELECT
        id,
        chunk_id,
        topic_order,
        topic_text,
        created_at,
        selected
      FROM forge_topics_backup
      ORDER BY id ASC
    `;
    yield* sql`
      INSERT INTO forge_topic_generation (
        id,
        topic_id,
        status,
        error_message,
        generation_started_at,
        status_changed_at,
        generation_revision
      )
      SELECT
        id,
        topic_id,
        status,
        error_message,
        generation_started_at,
        status_changed_at,
        generation_revision
      FROM forge_topic_generation_backup
      ORDER BY id ASC
    `;
    yield* sql`
      INSERT INTO forge_cards (
        id,
        topic_id,
        card_order,
        question,
        answer,
        created_at,
        added_to_deck_at
      )
      SELECT
        id,
        topic_id,
        card_order,
        question,
        answer,
        created_at,
        added_to_deck_at
      FROM forge_cards_backup
      ORDER BY id ASC
    `;
    yield* sql`
      INSERT INTO forge_card_permutations (
        id,
        source_card_id,
        permutation_order,
        question,
        answer,
        created_at,
        added_count
      )
      SELECT
        id,
        source_card_id,
        permutation_order,
        question,
        answer,
        created_at,
        added_count
      FROM forge_card_permutations_backup
      ORDER BY id ASC
    `;
    yield* sql`
      INSERT INTO forge_card_cloze (
        id,
        source_card_id,
        cloze_text,
        created_at,
        updated_at,
        added_count
      )
      SELECT
        id,
        source_card_id,
        cloze_text,
        created_at,
        updated_at,
        added_count
      FROM forge_card_cloze_backup
      ORDER BY id ASC
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
    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_sessions_source_kind_file_path_created_idx
      ON forge_sessions(source_kind, source_file_path, created_at DESC, id DESC)
    `;
    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS forge_chunks_session_sequence_idx
      ON forge_chunks(session_id, sequence_order)
    `;
    yield* sql`
      CREATE UNIQUE INDEX IF NOT EXISTS forge_topics_chunk_order_idx
      ON forge_topics(chunk_id, topic_order)
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_cards_topic_order_idx
      ON forge_cards(topic_id, card_order)
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS forge_card_permutations_source_order_idx
      ON forge_card_permutations(source_card_id, permutation_order)
    `;

    yield* sql`DROP TABLE forge_card_cloze_backup`;
    yield* sql`DROP TABLE forge_card_permutations_backup`;
    yield* sql`DROP TABLE forge_cards_backup`;
    yield* sql`DROP TABLE forge_topic_generation_backup`;
    yield* sql`DROP TABLE forge_topics_backup`;
    yield* sql`DROP TABLE forge_chunks_backup`;
    yield* sql`DROP TABLE forge_sessions_backup`;
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
