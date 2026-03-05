import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  ForgeSessionStatusTransitionError,
  makeInMemoryForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";

describe("forge session repository", () => {
  it("stores text sessions with a nullable sourceFilePath", async () => {
    const repository = makeInMemoryForgeSessionRepository();

    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "text",
        sourceLabel: "Pasted text",
        sourceFilePath: null,
        deckPath: null,
        sourceFingerprint: "fp:text-session",
      }),
    );

    expect(session.sourceKind).toBe("text");
    expect(session.sourceLabel).toBe("Pasted text");
    expect(session.sourceFilePath).toBeNull();

    const sessions = await Effect.runPromise(repository.listRecentSessions());
    expect(sessions[0]?.sourceKind).toBe("text");
    expect(sessions[0]?.sourceLabel).toBe("Pasted text");
    expect(sessions[0]?.sourceFilePath).toBeNull();
  });

  it("saveChunks inserts all rows on success", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/repo-save-success.pdf",
        deckPath: null,
        sourceFingerprint: "fp:repo-save-success",
      }),
    );

    await Effect.runPromise(
      repository.saveChunks(session.id, [
        {
          text: "chunk-1",
          sequenceOrder: 0,
          pageBoundaries: [{ offset: 0, page: 1 }],
        },
        {
          text: "chunk-2",
          sequenceOrder: 1,
          pageBoundaries: [{ offset: 0, page: 2 }],
        },
      ]),
    );

    const count = await Effect.runPromise(repository.getChunkCount(session.id));
    expect(count).toBe(2);
  });

  it("getChunks returns ordered rows with cloned page boundaries", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/repo-get-chunks.pdf",
        deckPath: null,
        sourceFingerprint: "fp:repo-get-chunks",
      }),
    );

    await Effect.runPromise(
      repository.saveChunks(session.id, [
        {
          text: "chunk-2",
          sequenceOrder: 1,
          pageBoundaries: [{ offset: 0, page: 2 }],
        },
        {
          text: "chunk-1",
          sequenceOrder: 0,
          pageBoundaries: [{ offset: 0, page: 1 }],
        },
      ]),
    );

    const chunks = await Effect.runPromise(repository.getChunks(session.id));
    expect(chunks.map((chunk) => chunk.sequenceOrder)).toEqual([0, 1]);

    const firstBoundary = chunks[0]?.pageBoundaries[0] as { offset: number } | undefined;
    if (firstBoundary) {
      firstBoundary.offset = 999;
    }

    const freshRead = await Effect.runPromise(repository.getChunks(session.id));
    expect(freshRead[0]?.pageBoundaries[0]?.offset).toBe(0);
  });

  it("saveChunks rolls back batch when any insert fails", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/repo-save-rollback.pdf",
        deckPath: null,
        sourceFingerprint: "fp:repo-save-rollback",
      }),
    );

    const exit = await Effect.runPromiseExit(
      repository.saveChunks(session.id, [
        {
          text: "chunk-1",
          sequenceOrder: 0,
          pageBoundaries: [{ offset: 0, page: 1 }],
        },
        {
          text: "chunk-duplicate",
          sequenceOrder: 0,
          pageBoundaries: [{ offset: 0, page: 1 }],
        },
      ]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected saveChunks to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");

    const count = await Effect.runPromise(repository.getChunkCount(session.id));
    expect(count).toBe(0);
  });

  it("tryBeginExtraction succeeds only from created", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/repo-begin-extraction.pdf",
        deckPath: null,
        sourceFingerprint: "fp:repo-begin-extraction",
      }),
    );

    const firstBegin = await Effect.runPromise(repository.tryBeginExtraction(session.id));
    expect(firstBegin?.status).toBe("extracting");

    const secondBegin = await Effect.runPromise(repository.tryBeginExtraction(session.id));
    expect(secondBegin).toBeNull();
  });

  it("saveChunks fails when the session does not exist", async () => {
    const repository = makeInMemoryForgeSessionRepository();

    const exit = await Effect.runPromiseExit(
      repository.saveChunks(999, [
        {
          text: "chunk",
          sequenceOrder: 0,
          pageBoundaries: [{ offset: 0, page: 1 }],
        },
      ]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected saveChunks to fail for unknown sessions.");
    }
  });

  it("replaceTopicsForSession enforces sequence ownership and updates atomically", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const firstSession = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/repo-topics-first.pdf",
        deckPath: null,
        sourceFingerprint: "fp:repo-topics-first",
      }),
    );
    const secondSession = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/repo-topics-second.pdf",
        deckPath: null,
        sourceFingerprint: "fp:repo-topics-second",
      }),
    );

    await Effect.runPromise(
      repository.saveChunks(firstSession.id, [
        {
          text: "first-0",
          sequenceOrder: 0,
          pageBoundaries: [{ offset: 0, page: 1 }],
        },
        {
          text: "first-1",
          sequenceOrder: 1,
          pageBoundaries: [{ offset: 0, page: 2 }],
        },
      ]),
    );
    await Effect.runPromise(
      repository.saveChunks(secondSession.id, [
        {
          text: "second-0",
          sequenceOrder: 0,
          pageBoundaries: [{ offset: 0, page: 1 }],
        },
      ]),
    );

    await Effect.runPromise(
      repository.replaceTopicsForSession(firstSession.id, [
        {
          sequenceOrder: 0,
          topics: ["alpha", "beta"],
        },
        {
          sequenceOrder: 1,
          topics: ["gamma"],
        },
      ]),
    );

    const firstTopics = await Effect.runPromise(repository.getTopicsBySession(firstSession.id));
    expect(firstTopics).toHaveLength(2);
    expect(firstTopics[0]?.sequenceOrder).toBe(0);
    expect(firstTopics[0]?.topics).toEqual(["alpha", "beta"]);
    expect(firstTopics[1]?.sequenceOrder).toBe(1);
    expect(firstTopics[1]?.topics).toEqual(["gamma"]);

    const secondTopics = await Effect.runPromise(repository.getTopicsBySession(secondSession.id));
    expect(secondTopics).toEqual([
      {
        chunkId: expect.any(Number),
        sequenceOrder: 0,
        topics: [],
      },
    ]);

    const invalidSequenceExit = await Effect.runPromiseExit(
      repository.replaceTopicsForSession(firstSession.id, [
        {
          sequenceOrder: 99,
          topics: ["nope"],
        },
      ]),
    );
    expect(Exit.isFailure(invalidSequenceExit)).toBe(true);

    const duplicateWritesExit = await Effect.runPromiseExit(
      repository.replaceTopicsForSession(firstSession.id, [
        {
          sequenceOrder: 0,
          topics: ["first"],
        },
        {
          sequenceOrder: 0,
          topics: ["second"],
        },
      ]),
    );
    expect(Exit.isFailure(duplicateWritesExit)).toBe(true);

    const unchangedTopics = await Effect.runPromise(repository.getTopicsBySession(firstSession.id));
    expect(unchangedTopics).toEqual(firstTopics);
  });

  it("rejects invalid status transitions", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/forge-transition.pdf",
        deckPath: null,
        sourceFingerprint: "fp-transition",
      }),
    );

    const exit = await Effect.runPromiseExit(
      repository.setSessionStatus({
        sessionId: session.id,
        status: "ready",
        errorMessage: null,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected invalid transition to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(ForgeSessionStatusTransitionError);
    }
  });

  it("allows ready to generating transitions", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/forge-ready-cycle.pdf",
        deckPath: null,
        sourceFingerprint: "fp-ready-cycle",
      }),
    );

    const transitions = [
      "extracting",
      "extracted",
      "topics_extracting",
      "topics_extracted",
      "generating",
      "ready",
      "generating",
    ] as const;

    let current = session;
    for (const status of transitions) {
      const updated = await Effect.runPromise(
        repository.setSessionStatus({
          sessionId: current.id,
          status,
          errorMessage: null,
        }),
      );

      if (!updated) {
        throw new Error("Session disappeared during transition test.");
      }
      current = updated;
    }

    expect(current.status).toBe("generating");
  });

  it("starts topic generation once and rejects concurrent start", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/forge-topic-generation-start.pdf",
        deckPath: null,
        sourceFingerprint: "fp-topic-generation-start",
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
      repository.getTopicByRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
    );
    if (!topic) {
      throw new Error("Expected persisted topic.");
    }

    const started = await Effect.runPromise(repository.tryStartTopicGeneration(topic.topicId));
    expect(started.status).toBe("generating");

    const secondStart = await Effect.runPromiseExit(
      repository.tryStartTopicGeneration(topic.topicId),
    );
    expect(Exit.isFailure(secondStart)).toBe(true);
  });

  it("replaces cards and returns topic cards snapshot rows", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/forge-cards-snapshot.pdf",
        deckPath: null,
        sourceFingerprint: "fp-cards-snapshot",
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
      repository.getTopicByRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
    );
    if (!topic) {
      throw new Error("Expected persisted topic.");
    }

    await Effect.runPromise(repository.tryStartTopicGeneration(topic.topicId));
    await Effect.runPromise(
      repository.replaceCardsForTopicAndFinishGenerationSuccess({
        topicId: topic.topicId,
        cards: [
          { question: "Q1", answer: "A1" },
          { question: "Q2", answer: "A2" },
        ],
      }),
    );

    const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.status).toBe("generated");
    expect(snapshot[0]?.cardCount).toBe(2);
    expect(snapshot[0]?.addedCount).toBe(0);

    const detail = await Effect.runPromise(
      repository.getCardsForTopicRef({
        sessionId: session.id,
        chunkId: 1,
        topicIndex: 0,
      }),
    );
    expect(detail?.cards).toHaveLength(2);
    expect(detail?.cards[0]?.question).toBe("Q1");
    expect(detail?.cards[0]?.addedToDeck).toBe(false);

    const firstCardId = detail?.cards[0]?.id;
    if (!firstCardId) {
      throw new Error("Expected first generated card id.");
    }

    await Effect.runPromise(repository.markCardAddedToDeck(firstCardId));

    const snapshotAfterAdd = await Effect.runPromise(
      repository.getCardsSnapshotBySession(session.id),
    );
    expect(snapshotAfterAdd[0]?.addedCount).toBe(1);

    const detailAfterAdd = await Effect.runPromise(
      repository.getCardsForTopicRef({
        sessionId: session.id,
        chunkId: 1,
        topicIndex: 0,
      }),
    );
    expect(detailAfterAdd?.cards[0]?.addedToDeck).toBe(true);
  });

  it("replaces permutations and upserts cloze for a card", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/forge-card-variants.pdf",
        deckPath: null,
        sourceFingerprint: "fp-card-variants",
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
      repository.getTopicByRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
    );
    if (!topic) {
      throw new Error("Expected persisted topic.");
    }

    await Effect.runPromise(
      repository.replaceCardsForTopic({
        topicId: topic.topicId,
        cards: [{ question: "Q1", answer: "A1" }],
      }),
    );
    const detail = await Effect.runPromise(
      repository.getCardsForTopicRef({
        sessionId: session.id,
        chunkId: 1,
        topicIndex: 0,
      }),
    );
    const sourceCardId = detail?.cards[0]?.id;
    if (!sourceCardId) {
      throw new Error("Expected persisted source card.");
    }

    await Effect.runPromise(
      repository.replacePermutationsForCard({
        sourceCardId,
        permutations: [
          { question: "P1", answer: "A1" },
          { question: "P2", answer: "A2" },
        ],
      }),
    );
    const permutations = await Effect.runPromise(repository.getPermutationsForCard(sourceCardId));
    expect(permutations).toHaveLength(2);
    expect(permutations[0]?.addedCount).toBe(0);

    const firstPermutationId = permutations[0]?.id;
    if (!firstPermutationId) {
      throw new Error("Expected persisted permutation id.");
    }

    await Effect.runPromise(
      repository.incrementPermutationAddedCount({
        permutationId: firstPermutationId,
        incrementBy: 1,
      }),
    );
    const permutationsAfterAdd = await Effect.runPromise(
      repository.getPermutationsForCard(sourceCardId),
    );
    expect(permutationsAfterAdd[0]?.addedCount).toBe(1);

    await Effect.runPromise(
      repository.upsertClozeForCard({
        sourceCardId,
        clozeText: "{{c1::answer}}",
      }),
    );
    const cloze = await Effect.runPromise(repository.getClozeForCard(sourceCardId));
    expect(cloze?.clozeText).toBe("{{c1::answer}}");
    expect(cloze?.addedCount).toBe(0);

    await Effect.runPromise(
      repository.incrementClozeAddedCount({
        sourceCardId,
        incrementBy: 2,
      }),
    );
    const clozeAfterAdd = await Effect.runPromise(repository.getClozeForCard(sourceCardId));
    expect(clozeAfterAdd?.addedCount).toBe(2);

    await Effect.runPromise(
      repository.upsertClozeForCard({
        sourceCardId,
        clozeText: "{{c1::answer}}",
      }),
    );
    const clozeAfterSameTextUpsert = await Effect.runPromise(
      repository.getClozeForCard(sourceCardId),
    );
    expect(clozeAfterSameTextUpsert?.addedCount).toBe(2);

    await Effect.runPromise(
      repository.upsertClozeForCard({
        sourceCardId,
        clozeText: "{{c1::different}}",
      }),
    );
    const clozeAfterChangedTextUpsert = await Effect.runPromise(
      repository.getClozeForCard(sourceCardId),
    );
    expect(clozeAfterChangedTextUpsert?.addedCount).toBe(0);
  });

  describe("listRecentSessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const repository = makeInMemoryForgeSessionRepository();
      const sessions = await Effect.runPromise(repository.listRecentSessions());
      expect(sessions).toEqual([]);
    });

    it("returns sessions ordered by updatedAt descending", async () => {
      vi.useFakeTimers({ now: new Date("2026-02-28T10:00:00.000Z") });
      try {
        const repository = makeInMemoryForgeSessionRepository();
        const first = await Effect.runPromise(
          repository.createSession({
            sourceKind: "pdf",
            sourceLabel: "Test PDF",
            sourceFilePath: "/tmp/first.pdf",
            deckPath: null,
            sourceFingerprint: "fp:first",
          }),
        );

        vi.advanceTimersByTime(1000);

        await Effect.runPromise(
          repository.createSession({
            sourceKind: "pdf",
            sourceLabel: "Test PDF",
            sourceFilePath: "/tmp/second.pdf",
            deckPath: null,
            sourceFingerprint: "fp:second",
          }),
        );

        vi.advanceTimersByTime(1000);

        await Effect.runPromise(
          repository.setSessionStatus({
            sessionId: first.id,
            status: "extracting",
            errorMessage: null,
          }),
        );

        const sessions = await Effect.runPromise(repository.listRecentSessions());
        expect(sessions.length).toBe(2);
        expect(sessions[0]?.sourceFilePath).toBe("/tmp/first.pdf");
        expect(sessions[1]?.sourceFilePath).toBe("/tmp/second.pdf");
      } finally {
        vi.useRealTimers();
      }
    });

    it("includes topic and card counts", async () => {
      const repository = makeInMemoryForgeSessionRepository();
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/counts.pdf",
          deckPath: null,
          sourceFingerprint: "fp:counts",
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
          topics: ["alpha", "beta"],
        }),
      );
      await Effect.runPromise(
        repository.saveTopicSelections({
          sessionId: session.id,
          selections: [
            { chunkId: 1, topicIndex: 0 },
            { chunkId: 1, topicIndex: 1 },
          ],
        }),
      );

      const topic = await Effect.runPromise(
        repository.getTopicByRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
      );
      if (!topic) throw new Error("Expected persisted topic.");

      await Effect.runPromise(repository.tryStartTopicGeneration(topic.topicId));
      await Effect.runPromise(
        repository.replaceCardsForTopicAndFinishGenerationSuccess({
          topicId: topic.topicId,
          cards: [
            { question: "Q1", answer: "A1" },
            { question: "Q2", answer: "A2" },
          ],
        }),
      );

      const sessions = await Effect.runPromise(repository.listRecentSessions());
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.topicCount).toBe(2);
      expect(sessions[0]?.cardCount).toBe(2);
    });

    it("topicCount only counts selected topics", async () => {
      const repository = makeInMemoryForgeSessionRepository();
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/selected-count.pdf",
          deckPath: null,
          sourceFingerprint: "fp:selected-count",
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
          topics: ["alpha", "beta", "gamma"],
        }),
      );

      const before = await Effect.runPromise(repository.listRecentSessions());
      expect(before[0]?.topicCount).toBe(0);

      await Effect.runPromise(
        repository.saveTopicSelections({
          sessionId: session.id,
          selections: [{ chunkId: 1, topicIndex: 0 }],
        }),
      );

      const after = await Effect.runPromise(repository.listRecentSessions());
      expect(after[0]?.topicCount).toBe(1);
    });

    it("returns correct status and errorMessage", async () => {
      const repository = makeInMemoryForgeSessionRepository();
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/error-session.pdf",
          deckPath: null,
          sourceFingerprint: "fp:error-session",
        }),
      );

      await Effect.runPromise(
        repository.setSessionStatus({
          sessionId: session.id,
          status: "extracting",
          errorMessage: null,
        }),
      );
      await Effect.runPromise(
        repository.setSessionStatus({
          sessionId: session.id,
          status: "error",
          errorMessage: "Something went wrong",
        }),
      );

      const sessions = await Effect.runPromise(repository.listRecentSessions());
      expect(sessions[0]?.status).toBe("error");
      expect(sessions[0]?.errorMessage).toBe("Something went wrong");
    });

    it("returns persisted deckPath in session summaries", async () => {
      const repository = makeInMemoryForgeSessionRepository();
      const session = await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/deck-target.pdf",
          deckPath: null,
          sourceFingerprint: "fp:deck-target",
        }),
      );

      await Effect.runPromise(
        repository.setSessionDeckPath({
          sessionId: session.id,
          deckPath: "/workspace/decks/biology.md",
        }),
      );

      const sessions = await Effect.runPromise(repository.listRecentSessions());
      expect(sessions[0]?.deckPath).toBe("/workspace/decks/biology.md");
    });

    it("reports zero counts for a session with no chunks", async () => {
      const repository = makeInMemoryForgeSessionRepository();
      await Effect.runPromise(
        repository.createSession({
          sourceKind: "pdf",
          sourceLabel: "Test PDF",
          sourceFilePath: "/tmp/bare.pdf",
          deckPath: null,
          sourceFingerprint: "fp:bare",
        }),
      );

      const sessions = await Effect.runPromise(repository.listRecentSessions());
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.topicCount).toBe(0);
      expect(sessions[0]?.cardCount).toBe(0);
    });
  });

  it("recovers stale generating topics into error state", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
        sourceLabel: "Test PDF",
        sourceFilePath: "/tmp/forge-stale-recovery.pdf",
        deckPath: null,
        sourceFingerprint: "fp-stale-recovery",
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
      repository.getTopicByRef({ sessionId: session.id, chunkId: 1, topicIndex: 0 }),
    );
    if (!topic) {
      throw new Error("Expected persisted topic.");
    }

    await Effect.runPromise(repository.tryStartTopicGeneration(topic.topicId));

    const recovered = await Effect.runPromise(
      repository.recoverStaleGeneratingTopics({
        sessionId: session.id,
        staleBeforeIso: new Date(Date.now() + 10_000).toISOString(),
        message: "Generation interrupted; please retry.",
      }),
    );
    expect(recovered).toBe(1);

    const snapshot = await Effect.runPromise(repository.getCardsSnapshotBySession(session.id));
    expect(snapshot[0]?.status).toBe("error");
    expect(snapshot[0]?.errorMessage).toBe("Generation interrupted; please retry.");
  });
});
