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
  it("stores detail topics and returns canonical cards snapshot rows", async () => {
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

    await Effect.runPromise(
      repository.replaceTopicsForSessionAndSetExtractionOutcome({
        sessionId: session.id,
        writes: [{ sequenceOrder: 0, topics: ["alpha", "beta"] }],
        status: "extracted",
        errorMessage: null,
      }),
    );

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

});
