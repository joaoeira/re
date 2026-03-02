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
  it("updates and persists session deck_path", async () => {
    const { repository, dispose } = await setupSqliteRepository();

    try {
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
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

      const snapshotAfterAdd = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(snapshotAfterAdd[0]?.addedCount).toBe(1);
    } finally {
      await dispose();
    }
  });
});
