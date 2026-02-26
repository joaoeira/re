import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  ForgeSessionStatusTransitionError,
  makeInMemoryForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";

describe("forge session repository", () => {
  it("saveChunks inserts all rows on success", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
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

  it("saveChunks rolls back batch when any insert fails", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
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

  it("rejects invalid status transitions", async () => {
    const repository = makeInMemoryForgeSessionRepository();
    const session = await Effect.runPromise(
      repository.createSession({
        sourceKind: "pdf",
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
});
