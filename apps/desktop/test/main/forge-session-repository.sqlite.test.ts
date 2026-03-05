import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import * as SqlClient from "@effect/sql/SqlClient";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { createSqliteReviewAnalyticsRuntimeBundle } from "@main/analytics";
import {
  ForgeSessionRepositoryError,
  makeSqliteForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";

const sqliteBindingAvailable = await (async () => {
  let probeRoot: string | null = null;
  let runtime:
    | Awaited<ReturnType<typeof createSqliteReviewAnalyticsRuntimeBundle>>["runtime"]
    | null = null;

  try {
    probeRoot = await fs.mkdtemp(path.join(tmpdir(), "re-forge-sqlite-probe-"));
    const probeBundle = createSqliteReviewAnalyticsRuntimeBundle({
      dbPath: path.join(probeRoot, "probe.db"),
      journalPath: path.join(probeRoot, "probe-journal.json"),
    });
    runtime = probeBundle.runtime;
    await runtime.runPromise(probeBundle.startupEffect);
    return true;
  } catch {
    return false;
  } finally {
    if (runtime) {
      await runtime.dispose();
    }
    if (probeRoot) {
      await fs.rm(probeRoot, { recursive: true, force: true });
    }
  }
})();

const setupSqliteRepository = async () => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "re-forge-sqlite-repo-"));
  const dbPath = path.join(tempRoot, "re.db");
  const journalPath = path.join(tempRoot, "journal.json");
  const analyticsBundle = createSqliteReviewAnalyticsRuntimeBundle({
    dbPath,
    journalPath,
  });

  await analyticsBundle.runtime.runPromise(analyticsBundle.startupEffect);

  const repository = makeSqliteForgeSessionRepository({
    runtime: analyticsBundle.runtime,
  });

  return {
    repository,
    runtime: analyticsBundle.runtime,
    dispose: async () => {
      await analyticsBundle.runtime.dispose();
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
};

(sqliteBindingAvailable ? describe : describe.skip)("sqlite forge session repository", () => {
  it("migrates legacy forge session data without dropping child rows and preserves timestamp defaults", async () => {
    const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "re-forge-sqlite-migration-"));
    const dbPath = path.join(tempRoot, "re.db");
    const journalPath = path.join(tempRoot, "journal.json");
    // @ts-expect-error better-sqlite3 types are not installed in this workspace.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);

    try {
      db.pragma("foreign_keys = ON");
      db.exec(`
        CREATE TABLE effect_sql_migrations (
          migration_id integer PRIMARY KEY NOT NULL,
          created_at datetime NOT NULL DEFAULT current_timestamp,
          name VARCHAR(255) NOT NULL
        );

        CREATE TABLE forge_sessions (
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
        );

        CREATE TABLE forge_chunks (
          id INTEGER PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES forge_sessions(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          sequence_order INTEGER NOT NULL CHECK (sequence_order >= 0),
          page_boundaries TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE TABLE forge_topics (
          id INTEGER PRIMARY KEY,
          chunk_id INTEGER NOT NULL REFERENCES forge_chunks(id) ON DELETE CASCADE,
          topic_order INTEGER NOT NULL CHECK (topic_order >= 0),
          topic_text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          selected INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE forge_topic_generation (
          id INTEGER PRIMARY KEY,
          topic_id INTEGER NOT NULL REFERENCES forge_topics(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('idle', 'generating', 'generated', 'error')),
          error_message TEXT,
          generation_started_at TEXT,
          status_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          generation_revision INTEGER NOT NULL DEFAULT 0,
          UNIQUE(topic_id)
        );

        CREATE TABLE forge_cards (
          id INTEGER PRIMARY KEY,
          topic_id INTEGER NOT NULL REFERENCES forge_topics(id) ON DELETE CASCADE,
          card_order INTEGER NOT NULL CHECK (card_order >= 0),
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          added_to_deck_at TEXT,
          UNIQUE(topic_id, card_order)
        );

        CREATE TABLE forge_card_permutations (
          id INTEGER PRIMARY KEY,
          source_card_id INTEGER NOT NULL REFERENCES forge_cards(id) ON DELETE CASCADE,
          permutation_order INTEGER NOT NULL CHECK (permutation_order >= 0),
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          added_count INTEGER NOT NULL DEFAULT 0,
          UNIQUE(source_card_id, permutation_order)
        );

        CREATE TABLE forge_card_cloze (
          id INTEGER PRIMARY KEY,
          source_card_id INTEGER NOT NULL UNIQUE REFERENCES forge_cards(id) ON DELETE CASCADE,
          cloze_text TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          added_count INTEGER NOT NULL DEFAULT 0
        );
      `);

      const insertMigration = db.prepare(`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (?, ?)
      `);
      for (let migrationId = 1; migrationId <= 10; migrationId += 1) {
        insertMigration.run(migrationId, `migration_${migrationId}`);
      }

      db.prepare(`
        INSERT INTO forge_sessions (
          id,
          source_kind,
          source_file_path,
          deck_path,
          source_fingerprint,
          status,
          error_message,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        1,
        "pdf",
        "/tmp/legacy.pdf",
        null,
        "fp:legacy",
        "ready",
        null,
        "2025-01-01T00:00:00.000Z",
        "2025-01-01T00:00:00.000Z",
      );
      db.prepare(`
        INSERT INTO forge_chunks (
          id,
          session_id,
          text,
          sequence_order,
          page_boundaries,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(10, 1, "legacy chunk", 0, '[{"offset":0,"page":1}]', "2025-01-01T00:00:00.000Z");
      db.prepare(`
        INSERT INTO forge_topics (
          id,
          chunk_id,
          topic_order,
          topic_text,
          created_at,
          selected
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(20, 10, 0, "legacy topic", "2025-01-01T00:00:00.000Z", 1);
      db.prepare(`
        INSERT INTO forge_topic_generation (
          id,
          topic_id,
          status,
          error_message,
          generation_started_at,
          status_changed_at,
          generation_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(30, 20, "generated", null, "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", 1);
      db.prepare(`
        INSERT INTO forge_cards (
          id,
          topic_id,
          card_order,
          question,
          answer,
          created_at,
          added_to_deck_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        40,
        20,
        0,
        "Legacy question?",
        "Legacy answer.",
        "2025-01-01T00:00:00.000Z",
        "2025-01-02T00:00:00.000Z",
      );
      db.prepare(`
        INSERT INTO forge_card_permutations (
          id,
          source_card_id,
          permutation_order,
          question,
          answer,
          created_at,
          added_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(50, 40, 0, "Legacy permutation?", "Legacy answer.", "2025-01-01T00:00:00.000Z", 1);
      db.prepare(`
        INSERT INTO forge_card_cloze (
          id,
          source_card_id,
          cloze_text,
          created_at,
          updated_at,
          added_count
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        60,
        40,
        "Legacy {{c1::answer}}.",
        "2025-01-01T00:00:00.000Z",
        "2025-01-01T00:00:00.000Z",
        1,
      );
    } finally {
      db.close();
    }

    const analyticsBundle = createSqliteReviewAnalyticsRuntimeBundle({
      dbPath,
      journalPath,
    });

    try {
      await analyticsBundle.runtime.runPromise(analyticsBundle.startupEffect);

      const repository = makeSqliteForgeSessionRepository({
        runtime: analyticsBundle.runtime,
      });

      const legacySession = await Effect.runPromise(repository.getSession(1));
      expect(legacySession?.sourceLabel).toBe("legacy.pdf");
      expect(legacySession?.sourceFilePath).toBe("/tmp/legacy.pdf");

      const childCounts = await analyticsBundle.runtime.runPromise(
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const readCount = (
            effect: Effect.Effect<ReadonlyArray<{ count: number }>, unknown, SqlClient.SqlClient>,
          ) => effect.pipe(Effect.map((rows) => Number(rows[0]?.count ?? 0)));

          return {
            chunks: yield* readCount(
              sql<{ count: number }>`SELECT COUNT(*) AS count FROM forge_chunks`,
            ),
            topics: yield* readCount(
              sql<{ count: number }>`SELECT COUNT(*) AS count FROM forge_topics`,
            ),
            topicGeneration: yield* readCount(
              sql<{ count: number }>`SELECT COUNT(*) AS count FROM forge_topic_generation`,
            ),
            cards: yield* readCount(
              sql<{ count: number }>`SELECT COUNT(*) AS count FROM forge_cards`,
            ),
            permutations: yield* readCount(
              sql<{ count: number }>`SELECT COUNT(*) AS count FROM forge_card_permutations`,
            ),
            cloze: yield* readCount(
              sql<{ count: number }>`SELECT COUNT(*) AS count FROM forge_card_cloze`,
            ),
          };
        }),
      );

      expect(childCounts).toEqual({
        chunks: 1,
        topics: 1,
        topicGeneration: 1,
        cards: 1,
        permutations: 1,
        cloze: 1,
      });

      const created = await Effect.runPromise(
        repository.createSession({
          sourceKind: "text",
          sourceLabel: "Pasted text",
          sourceFilePath: null,
          deckPath: null,
          sourceFingerprint: "fp:new-text",
        }),
      );
      expect(created.createdAt.length).toBeGreaterThan(0);
      expect(created.updatedAt.length).toBeGreaterThan(0);
    } finally {
      await analyticsBundle.runtime.dispose();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("updates and persists session deck_path", async () => {
    const { repository, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/sqlite-deck-target.pdf",
          deckPath: null,
          sourceFingerprint: "fp:sqlite-deck-target",
        }),
      );

      const updated = await Effect.runPromise(
        repository.setSessionDeckPath({
          sessionId: session.id,
          deckPath: "/workspace/decks/sqlite.md",
        }),
      );

      expect(updated?.deckPath).toBe("/workspace/decks/sqlite.md");

      const summaries = await Effect.runPromise(repository.listRecentSessions());
      expect(summaries[0]?.deckPath).toBe("/workspace/decks/sqlite.md");
    } finally {
      await dispose();
    }
  });

  it("includes chunk entries with empty topics in getTopicsBySession", async () => {
    const { repository, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/sqlite-empty-topics.pdf",
          deckPath: null,
          sourceFingerprint: "fp:sqlite-empty-topics",
        }),
      );

      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-0",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
          {
            text: "chunk-1",
            sequenceOrder: 1,
            pageBoundaries: [{ offset: 0, page: 2 }],
          },
        ]),
      );

      await Effect.runPromise(
        repository.replaceTopicsForSession(session.id, [
          {
            sequenceOrder: 0,
            topics: [],
          },
          {
            sequenceOrder: 1,
            topics: ["topic-1"],
          },
        ]),
      );

      const topicsByChunk = await Effect.runPromise(repository.getTopicsBySession(session.id));
      expect(topicsByChunk).toEqual([
        {
          chunkId: expect.any(Number),
          sequenceOrder: 0,
          topics: [],
        },
        {
          chunkId: expect.any(Number),
          sequenceOrder: 1,
          topics: ["topic-1"],
        },
      ]);
    } finally {
      await dispose();
    }
  });

  it("fails getChunks when page_boundaries is invalid JSON", async () => {
    const { repository, runtime, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/sqlite-invalid-json.pdf",
          deckPath: null,
          sourceFingerprint: "fp:sqlite-invalid-json",
        }),
      );

      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          yield* sql`
            INSERT INTO forge_chunks (
              session_id,
              text,
              sequence_order,
              page_boundaries
            ) VALUES (
              ${session.id},
              ${"chunk-invalid-json"},
              ${0},
              ${"not-json"}
            )
          `;
        }),
      );

      const exit = await Effect.runPromiseExit(repository.getChunks(session.id));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected getChunks to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(ForgeSessionRepositoryError);
        if (failure.value instanceof ForgeSessionRepositoryError) {
          expect(failure.value.operation).toBe("getChunks.parsePageBoundaries");
        }
      }
    } finally {
      await dispose();
    }
  });

  it("fails getChunks when page_boundaries JSON does not match schema", async () => {
    const { repository, runtime, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/sqlite-invalid-schema.pdf",
          deckPath: null,
          sourceFingerprint: "fp:sqlite-invalid-schema",
        }),
      );

      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          yield* sql`
            INSERT INTO forge_chunks (
              session_id,
              text,
              sequence_order,
              page_boundaries
            ) VALUES (
              ${session.id},
              ${"chunk-invalid-schema"},
              ${0},
              ${'[{"offset":-1,"page":1}]'}
            )
          `;
        }),
      );

      const exit = await Effect.runPromiseExit(repository.getChunks(session.id));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected getChunks to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(ForgeSessionRepositoryError);
        if (failure.value instanceof ForgeSessionRepositoryError) {
          expect(failure.value.operation).toBe("getChunks.validatePageBoundaries");
        }
      }
    } finally {
      await dispose();
    }
  });

  it("persists cards domain rows and reads cards snapshot", async () => {
    const { repository, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/sqlite-cards-domain.pdf",
          deckPath: null,
          sourceFingerprint: "fp:sqlite-cards-domain",
        }),
      );

      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-0",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["topic-a"],
        }),
      );

      const topic = await Effect.runPromise(
        repository.getTopicByRef({
          sessionId: session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );
      if (!topic) {
        throw new Error("Expected persisted topic.");
      }

      await Effect.runPromise(repository.tryStartTopicGeneration(topic.topicId));
      await Effect.runPromise(
        repository.replaceCardsForTopicAndFinishGenerationSuccess({
          topicId: topic.topicId,
          cards: [{ question: "Q1", answer: "A1" }],
        }),
      );

      const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]?.status).toBe("generated");
      expect(snapshot[0]?.cardCount).toBe(1);
      expect(snapshot[0]?.addedCount).toBe(0);
      expect(snapshot[0]?.generationRevision).toBe(1);

      const detail = await Effect.runPromise(
        repository.getCardsForTopicRef({
          sessionId: session.id,
          chunkId: 1,
          topicIndex: 0,
        }),
      );
      const sourceCardId = detail?.cards[0]?.id;
      if (!sourceCardId) {
        throw new Error("Expected generated card id.");
      }

      await Effect.runPromise(repository.markCardAddedToDeck(sourceCardId));

      const snapshotAfterAdd = await Effect.runPromise(
        repository.getCardsSnapshotBySession(session.id),
      );
      expect(snapshotAfterAdd[0]?.addedCount).toBe(1);
    } finally {
      await dispose();
    }
  });
});
