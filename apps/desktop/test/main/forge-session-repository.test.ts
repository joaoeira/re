import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeInMemoryForgeSessionRepository } from "@main/forge/services/forge-session-repository";

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

describe("forge session repository (canonical)", () => {
  it("stores detail and synthesis topics and returns canonical cards snapshot rows", async () => {
    const { repository, session } = await createSessionWithChunks();

    await Effect.runPromise(
      repository.replaceTopicsForSessionAndSetExtractionOutcome({
        sessionId: session.id,
        writes: [
          { sequenceOrder: 0, topics: ["alpha", "beta"] },
          { sequenceOrder: 1, topics: ["gamma"] },
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

    expect(snapshot).toHaveLength(4);
    expect(snapshot.map((topic) => topic.family)).toEqual([
      "detail",
      "detail",
      "detail",
      "synthesis",
    ]);
    expect(snapshot.at(-1)?.chunkId).toBeNull();
    expect(snapshot.at(-1)?.sequenceOrder).toBeNull();
    expect(outcomes).toEqual([
      expect.objectContaining({ family: "detail", status: "extracted" }),
      expect.objectContaining({ family: "synthesis", status: "extracted" }),
    ]);
  });

  it("persists topic-id selections across detail and synthesis topics", async () => {
    const { repository, session } = await createSessionWithChunks();

    await Effect.runPromise(
      repository.replaceTopicsForSessionAndSetExtractionOutcome({
        sessionId: session.id,
        writes: [{ sequenceOrder: 0, topics: ["alpha"] }],
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

    const before = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    const detailTopicId = before.find((topic) => topic.family === "detail")?.topicId;
    const synthesisTopicId = before.find((topic) => topic.family === "synthesis")?.topicId;
    if (!detailTopicId || !synthesisTopicId) {
      throw new Error("Expected detail and synthesis topic ids.");
    }

    await Effect.runPromise(
      repository.saveTopicSelectionsByTopicIds({
        sessionId: session.id,
        topicIds: [synthesisTopicId],
      }),
    );

    const after = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    expect(after.find((topic) => topic.topicId === detailTopicId)?.selected).toBe(false);
    expect(after.find((topic) => topic.topicId === synthesisTopicId)?.selected).toBe(true);
  });

  it("returns card/topic metadata without repository-side grounding text", async () => {
    const { repository, session } = await createSessionWithChunks();

    await Effect.runPromise(
      repository.replaceTopicsForSessionAndSetExtractionOutcome({
        sessionId: session.id,
        writes: [{ sequenceOrder: 0, topics: ["alpha"] }],
        status: "extracted",
        errorMessage: null,
      }),
    );

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

  it("returns full session text by concatenating chunks in sequence order", async () => {
    const { repository, session } = await createSessionWithChunks();

    const text = await Effect.runPromise(repository.getFullSessionText(session.id));
    expect(text).toBe("chunk-a chunk-b");
  });

  it("returns empty string for session with no chunks", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "empty.pdf",
        sourceFilePath: "/tmp/empty.pdf",
        deckPath: null,
        sourceFingerprint: "fp:empty",
      }),
    );

    const text = await Effect.runPromise(repository.getFullSessionText(session.id));
    expect(text).toBe("");
  });

  it("returns synthesis topic with null chunkId via getTopicById", async () => {
    const { repository, session } = await createSessionWithChunks();

    await Effect.runPromise(
      repository.replaceSynthesisTopicsForSessionAndSetExtractionOutcome({
        sessionId: session.id,
        topics: ["cross-cutting theme"],
        status: "extracted",
        errorMessage: null,
      }),
    );

    const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    const synthesisTopic = snapshot.find((t) => t.family === "synthesis");
    if (!synthesisTopic) throw new Error("Expected synthesis topic.");

    const topic = await Effect.runPromise(repository.getTopicById(synthesisTopic.topicId));
    expect(topic).not.toBeNull();
    expect(topic?.family).toBe("synthesis");
    expect(topic?.chunkId).toBeNull();
    expect(topic?.chunkText).toBeNull();
    expect(topic?.sequenceOrder).toBeNull();
  });
});
