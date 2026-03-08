import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createSqliteReviewAnalyticsRuntimeBundle } from "@main/analytics";
import { makeSqliteForgeSessionRepository } from "@main/forge/services/forge-session-repository";

const sqliteBindingAvailable = await (async () => {
  let tempRoot: string | null = null;
  let runtime:
    | Awaited<ReturnType<typeof createSqliteReviewAnalyticsRuntimeBundle>>["runtime"]
    | null = null;

  try {
    tempRoot = await fs.mkdtemp(path.join(tmpdir(), "re-forge-sqlite-probe-"));
    const bundle = createSqliteReviewAnalyticsRuntimeBundle({
      dbPath: path.join(tempRoot, "probe.db"),
      journalPath: path.join(tempRoot, "probe-journal.json"),
    });
    runtime = bundle.runtime;
    await runtime.runPromise(bundle.startupEffect);
    return true;
  } catch {
    return false;
  } finally {
    if (runtime) {
      await runtime.dispose();
    }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
})();

const setupSqliteRepository = async () => {
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "re-forge-sqlite-repo-"));
  const bundle = createSqliteReviewAnalyticsRuntimeBundle({
    dbPath: path.join(tempRoot, "repo.db"),
    journalPath: path.join(tempRoot, "repo-journal.json"),
  });

  await bundle.runtime.runPromise(bundle.startupEffect);

  return {
    repository: makeSqliteForgeSessionRepository({ runtime: bundle.runtime }),
    dispose: async () => {
      await bundle.runtime.dispose();
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
};

(sqliteBindingAvailable ? describe : describe.skip)("sqlite forge session repository (canonical)", () => {
  it("migrates legacy forge topic graphs with generation and card rows", async () => {
    const tempRoot = await fs.mkdtemp(path.join(tmpdir(), "re-forge-sqlite-migration-"));
    const dbPath = path.join(tempRoot, "repo.db");
    const journalPath = path.join(tempRoot, "repo-journal.json");
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
          source_kind TEXT NOT NULL CHECK (source_kind IN ('pdf', 'text')),
          source_label TEXT NOT NULL,
          source_file_path TEXT,
          deck_path TEXT,
          source_fingerprint TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'created' CHECK (
            status IN (
              'created','extracting','extracted','topics_extracting','topics_extracted','generating','ready','error'
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
      `);

      const insertMigration = db.prepare(`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (?, ?)
      `);
      for (let migrationId = 1; migrationId <= 11; migrationId += 1) {
        insertMigration.run(migrationId, `migration_${migrationId}`);
      }

      db.prepare(`
        INSERT INTO forge_sessions (
          id, source_kind, source_label, source_file_path, deck_path, source_fingerprint, status, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        1,
        "pdf",
        "legacy.pdf",
        "/tmp/legacy.pdf",
        null,
        "fp:legacy",
        "ready",
        null,
        "2025-01-01T00:00:00.000Z",
        "2025-01-01T00:00:00.000Z",
      );
      db.prepare(`
        INSERT INTO forge_chunks (id, session_id, text, sequence_order, page_boundaries, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(10, 1, "legacy chunk", 0, '[{"offset":0,"page":1}]', "2025-01-01T00:00:00.000Z");
      db.prepare(`
        INSERT INTO forge_topics (id, chunk_id, topic_order, topic_text, created_at, selected)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(20, 10, 0, "legacy topic", "2025-01-01T00:00:00.000Z", 1);
      db.prepare(`
        INSERT INTO forge_topic_generation (
          id, topic_id, status, error_message, generation_started_at, status_changed_at, generation_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(30, 20, "generated", null, "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", 1);
      db.prepare(`
        INSERT INTO forge_cards (id, topic_id, card_order, question, answer, created_at, added_to_deck_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(40, 20, 0, "Q?", "A.", "2025-01-01T00:00:00.000Z", null);
      db.close();

      const bundle = createSqliteReviewAnalyticsRuntimeBundle({ dbPath, journalPath });
      try {
        await bundle.runtime.runPromise(bundle.startupEffect);
        const repository = makeSqliteForgeSessionRepository({ runtime: bundle.runtime });
        const snapshot = await bundle.runtime.runPromise(repository.getCardsSnapshotBySession(1));
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0]).toEqual(
          expect.objectContaining({
            topicId: 20,
            sessionId: 1,
            family: "detail",
            topicText: "legacy topic",
          }),
        );
      } finally {
        await bundle.runtime.dispose();
      }
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists canonical detail and synthesis topic snapshots", async () => {
    const { repository, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "source.pdf",
          sourceFilePath: "/tmp/source.pdf",
          deckPath: null,
          sourceFingerprint: "fp:sqlite",
        }),
      );

      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-a ",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
          {
            text: "chunk-b",
            sequenceOrder: 1,
            pageBoundaries: [{ offset: 0, page: 2 }],
          },
        ]),
      );

      await Effect.runPromise(
        repository.replaceTopicsForSessionAndSetExtractionOutcome({
          sessionId: session.id,
          writes: [
            { sequenceOrder: 0, topics: ["alpha"] },
            { sequenceOrder: 1, topics: ["beta"] },
          ],
          status: "extracted",
          errorMessage: null,
        }),
      );
      await Effect.runPromise(
        repository.replaceSynthesisTopicsForSessionAndSetExtractionOutcome({
          sessionId: session.id,
          topics: ["system theme"],
          status: "extracted",
          errorMessage: null,
        }),
      );

      const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      const outcomes = await Effect.runPromise(repository.getTopicExtractionOutcomes(session.id));

      expect(snapshot.map((topic) => topic.family)).toEqual(["detail", "detail", "synthesis"]);
      expect(snapshot.at(-1)?.chunkId).toBeNull();
      expect(snapshot.at(-1)?.sequenceOrder).toBeNull();
      expect(outcomes).toEqual([
        expect.objectContaining({ family: "detail", status: "extracted" }),
        expect.objectContaining({ family: "synthesis", status: "extracted" }),
      ]);
    } finally {
      await dispose();
    }
  });

  it("reads cards by topic id and omits repository-side grounding text", async () => {
    const { repository, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "source.pdf",
          sourceFilePath: "/tmp/source.pdf",
          deckPath: null,
          sourceFingerprint: "fp:sqlite-card",
        }),
      );

      await Effect.runPromise(
        repository.saveChunks(session.id, [
          {
            text: "chunk-a",
            sequenceOrder: 0,
            pageBoundaries: [{ offset: 0, page: 1 }],
          },
        ]),
      );
      await Effect.runPromise(
        repository.replaceTopicsForSessionAndSetExtractionOutcome({
          sessionId: session.id,
          writes: [{ sequenceOrder: 0, topics: ["alpha"] }],
          status: "extracted",
          errorMessage: null,
        }),
      );

      const topicId = (await Effect.runPromise(repository.getCardsSnapshotBySession(session.id)))[0]?.topicId;
      if (!topicId) throw new Error("Expected topic id.");

      await Effect.runPromise(repository.tryStartTopicGeneration(topicId));
      await Effect.runPromise(
        repository.replaceCardsForTopicAndFinishGenerationSuccess({
          topicId,
          cards: [{ question: "Q?", answer: "A." }],
        }),
      );

      const topicCards = await Effect.runPromise(repository.getCardsForTopicId(topicId));
      const cardId = topicCards?.cards[0]?.id;
      if (!cardId) throw new Error("Expected card id.");

      const sourceCard = await Effect.runPromise(repository.getCardById(cardId));
      expect(sourceCard).toEqual(
        expect.objectContaining({
          id: cardId,
          topicId,
          sessionId: session.id,
          topicText: "alpha",
        }),
      );
      expect("contextText" in (sourceCard ?? {})).toBe(false);
    } finally {
      await dispose();
    }
  });
});
