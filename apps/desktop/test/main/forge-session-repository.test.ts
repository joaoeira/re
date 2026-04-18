import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeInMemoryForgeSessionRepository,
  type ForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";

const createSessionWithChunks = async () => {
  const repository = makeInMemoryForgeSessionRepository();
  const session = await Effect.runPromise(
    repository.createSession({
      sourceKind: "pdf",
      sourceLabel: "source.pdf",
      sourceFilePath: "/tmp/source.pdf",
      deckPath: null,
      sourceFingerprint: "fp:repo",
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

  return { repository, session };
};

const extractTopics = async (
  repository: ForgeSessionRepository,
  sessionId: number,
  writes: ReadonlyArray<{ readonly sequenceOrder: number; readonly topics: ReadonlyArray<string> }>,
  outcome: { readonly status: "extracted" | "error"; readonly errorMessage: string | null } = {
    status: "extracted",
    errorMessage: null,
  },
) => {
  for (const write of writes) {
    await Effect.runPromise(
      repository.appendTopicsForChunk({
        sessionId,
        sequenceOrder: write.sequenceOrder,
        topics: write.topics,
      }),
    );
  }
  await Effect.runPromise(
    repository.setTopicExtractionOutcome({
      sessionId,
      status: outcome.status,
      errorMessage: outcome.errorMessage,
    }),
  );
};

describe("forge session repository (canonical)", () => {
  it("stores detail topics and returns canonical cards snapshot rows", async () => {
    const { repository, session } = await createSessionWithChunks();

    await extractTopics(repository, session.id, [
      { sequenceOrder: 0, topics: ["alpha", "beta"] },
      { sequenceOrder: 1, topics: ["gamma"] },
    ]);

    const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    const outcomes = await Effect.runPromise(repository.getTopicExtractionOutcomes(session.id));

    expect(snapshot).toHaveLength(3);
    expect(snapshot.map((topic) => topic.family)).toEqual(["detail", "detail", "detail"]);
    expect(outcomes).toEqual([
      expect.objectContaining({ family: "detail", status: "extracted" }),
    ]);
  });

  it("persists topic-id selections across detail topics", async () => {
    const { repository, session } = await createSessionWithChunks();

    await extractTopics(repository, session.id, [
      { sequenceOrder: 0, topics: ["alpha", "beta"] },
    ]);

    const before = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    const [first, second] = before;
    if (!first || !second) {
      throw new Error("Expected two detail topics.");
    }

    await Effect.runPromise(
      repository.saveTopicSelectionsByTopicIds({
        sessionId: session.id,
        topicIds: [second.topicId],
      }),
    );

    const after = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    expect(after.find((topic) => topic.topicId === first.topicId)?.selected).toBe(false);
    expect(after.find((topic) => topic.topicId === second.topicId)?.selected).toBe(true);
  });

  it("returns card/topic metadata without repository-side grounding text", async () => {
    const { repository, session } = await createSessionWithChunks();

    await extractTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["alpha"] }]);

    const topicId = (await Effect.runPromise(repository.getCardsSnapshotBySession(session.id)))[0]
      ?.topicId;
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
    if (!cardId) throw new Error("Expected source card id.");

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
  });

  describe("topic angles", () => {
    const createSessionWithTopic = async () => {
      const { repository, session } = await createSessionWithChunks();
      await extractTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["alpha"] }]);
      const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      const topicId = snapshot[0]?.topicId;
      if (!topicId) throw new Error("Expected topic id.");
      return { repository, session, topicId };
    };

    it("returns an empty array when no angles are persisted for a topic", async () => {
      const { repository, topicId } = await createSessionWithTopic();
      const angles = await Effect.runPromise(repository.getAnglesForTopicId(topicId));
      expect(angles).toEqual([]);
    });

    it("persists angles in order and reads them back by angle_order", async () => {
      const { repository, topicId } = await createSessionWithTopic();

      await Effect.runPromise(
        repository.replaceAnglesForTopic({
          topicId,
          angles: ["historical context", "mechanism of action", "clinical implications"],
        }),
      );

      const angles = await Effect.runPromise(repository.getAnglesForTopicId(topicId));
      expect(angles).toEqual([
        "historical context",
        "mechanism of action",
        "clinical implications",
      ]);
    });

    it("replaces all angles on a second call", async () => {
      const { repository, topicId } = await createSessionWithTopic();

      await Effect.runPromise(
        repository.replaceAnglesForTopic({
          topicId,
          angles: ["first", "second", "third"],
        }),
      );
      await Effect.runPromise(
        repository.replaceAnglesForTopic({
          topicId,
          angles: ["brand", "new"],
        }),
      );

      const angles = await Effect.runPromise(repository.getAnglesForTopicId(topicId));
      expect(angles).toEqual(["brand", "new"]);
    });

    it("clears angles when the replacement set is empty", async () => {
      const { repository, topicId } = await createSessionWithTopic();

      await Effect.runPromise(
        repository.replaceAnglesForTopic({
          topicId,
          angles: ["anything"],
        }),
      );
      await Effect.runPromise(
        repository.replaceAnglesForTopic({
          topicId,
          angles: [],
        }),
      );

      const angles = await Effect.runPromise(repository.getAnglesForTopicId(topicId));
      expect(angles).toEqual([]);
    });

    it("cascades angles removal when topics are re-extracted (in-memory model)", async () => {
      const { repository, session, topicId } = await createSessionWithTopic();

      await Effect.runPromise(
        repository.replaceAnglesForTopic({
          topicId,
          angles: ["will-be-wiped"],
        }),
      );

      await extractTopics(repository, session.id, [
        { sequenceOrder: 0, topics: ["renamed"] },
      ]);

      const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      const newTopicId = snapshot[0]?.topicId;
      if (!newTopicId) throw new Error("Expected replacement topic id.");

      const oldAngles = await Effect.runPromise(repository.getAnglesForTopicId(topicId));
      expect(oldAngles).toEqual([]);

      const newAngles = await Effect.runPromise(repository.getAnglesForTopicId(newTopicId));
      expect(newAngles).toEqual([]);
    });
  });

  describe("appendTopicsForChunk", () => {
    it("inserts topics scoped to one chunk without touching other chunks", async () => {
      const { repository, session } = await createSessionWithChunks();

      await Effect.runPromise(
        repository.appendTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["alpha", "beta"],
        }),
      );

      let snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(snapshot.map((topic) => topic.topicText)).toEqual(["alpha", "beta"]);

      await Effect.runPromise(
        repository.appendTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 1,
          topics: ["gamma"],
        }),
      );

      snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(snapshot.map((topic) => topic.topicText)).toEqual(["alpha", "beta", "gamma"]);
    });

    it("replaces only the targeted chunk's topics on a repeat call", async () => {
      const { repository, session } = await createSessionWithChunks();

      await Effect.runPromise(
        repository.appendTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["original"],
        }),
      );
      await Effect.runPromise(
        repository.appendTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 1,
          topics: ["other-chunk"],
        }),
      );
      await Effect.runPromise(
        repository.appendTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["retry-a", "retry-b"],
        }),
      );

      const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(snapshot.map((topic) => topic.topicText)).toEqual([
        "retry-a",
        "retry-b",
        "other-chunk",
      ]);
    });

    it("fails when the chunk sequence order does not exist for the session", async () => {
      const { repository, session } = await createSessionWithChunks();

      const result = await Effect.runPromise(
        repository
          .appendTopicsForChunk({
            sessionId: session.id,
            sequenceOrder: 42,
            topics: ["ghost"],
          })
          .pipe(Effect.either),
      );

      expect(result._tag).toBe("Left");
    });

    it("cascades angles removal when topics are re-appended for a chunk", async () => {
      const { repository, session } = await createSessionWithChunks();
      await Effect.runPromise(
        repository.appendTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["alpha"],
        }),
      );

      const firstSnapshot = await Effect.runPromise(
        repository.getCardsSnapshotBySession(session.id),
      );
      const firstTopicId = firstSnapshot[0]?.topicId;
      if (!firstTopicId) throw new Error("Expected topic id.");

      await Effect.runPromise(
        repository.replaceAnglesForTopic({ topicId: firstTopicId, angles: ["to-wipe"] }),
      );

      await Effect.runPromise(
        repository.appendTopicsForChunk({
          sessionId: session.id,
          sequenceOrder: 0,
          topics: ["replaced"],
        }),
      );

      const oldAngles = await Effect.runPromise(repository.getAnglesForTopicId(firstTopicId));
      expect(oldAngles).toEqual([]);
    });
  });

  describe("setTopicExtractionOutcome", () => {
    it("writes and updates the outcome row without touching topics", async () => {
      const { repository, session } = await createSessionWithChunks();
      await extractTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["alpha"] }]);

      const topicsBefore = await Effect.runPromise(
        repository.getCardsSnapshotBySession(session.id),
      );

      await Effect.runPromise(
        repository.setTopicExtractionOutcome({
          sessionId: session.id,
          status: "error",
          errorMessage: "chunk 2 failed",
        }),
      );

      const outcomes = await Effect.runPromise(repository.getTopicExtractionOutcomes(session.id));
      expect(outcomes).toEqual([
        expect.objectContaining({
          family: "detail",
          status: "error",
          errorMessage: "chunk 2 failed",
        }),
      ]);

      const topicsAfter = await Effect.runPromise(
        repository.getCardsSnapshotBySession(session.id),
      );
      expect(topicsAfter.map((topic) => topic.topicText)).toEqual(
        topicsBefore.map((topic) => topic.topicText),
      );
    });
  });

  describe("setTopicMarkedDone", () => {
    it("flips markedDone for a topic and reverts on second call", async () => {
      const { repository, session } = await createSessionWithChunks();
      await extractTopics(repository, session.id, [{ sequenceOrder: 0, topics: ["alpha"] }]);
      const topicId = (await Effect.runPromise(repository.getCardsSnapshotBySession(session.id)))[0]
        ?.topicId;
      if (!topicId) throw new Error("Expected topic id.");

      const initial = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(initial[0]?.markedDone).toBe(false);

      const markResult = await Effect.runPromise(
        repository.setTopicMarkedDone({ sessionId: session.id, topicId, markedDone: true }),
      );
      expect(markResult).toBe(true);

      const afterMark = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
      expect(afterMark[0]?.markedDone).toBe(true);

      const unmarkResult = await Effect.runPromise(
        repository.setTopicMarkedDone({ sessionId: session.id, topicId, markedDone: false }),
      );
      expect(unmarkResult).toBe(true);

      const afterUnmark = await Effect.runPromise(
        repository.getCardsSnapshotBySession(session.id),
      );
      expect(afterUnmark[0]?.markedDone).toBe(false);
    });

    it("returns false when the topic does not belong to the session", async () => {
      const { repository, session } = await createSessionWithChunks();
      const result = await Effect.runPromise(
        repository.setTopicMarkedDone({
          sessionId: session.id,
          topicId: 9999,
          markedDone: true,
        }),
      );
      expect(result).toBe(false);
    });
  });
});
