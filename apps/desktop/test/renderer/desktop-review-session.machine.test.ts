import { createActor, type ActorRefFrom } from "xstate";
import { describe, expect, it, vi } from "vitest";

import {
  desktopReviewSessionMachine,
  RecoverableCardLoadError,
} from "@/machines/desktopReviewSession";
import type { LightQueueItem, SerializedItemMetadata } from "@shared/rpc/schemas/review";

const queueItem = (overrides: Partial<LightQueueItem> = {}): LightQueueItem => ({
  deckPath: "/workspace/deck.md",
  cardId: "card-a",
  cardIndex: 0,
  deckName: "deck",
  ...overrides,
});

const previousCard: SerializedItemMetadata = {
  id: "card-a" as SerializedItemMetadata["id"],
  stability: { value: 0, raw: "0" },
  difficulty: { value: 0, raw: "0" },
  state: 0,
  learningSteps: 0,
  lastReview: null,
  due: null,
};

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const waitForSnapshot = async (
  actor: ActorRefFrom<typeof desktopReviewSessionMachine>,
  predicate: (snapshot: ReturnType<typeof actor.getSnapshot>) => boolean,
  timeoutMs = 1500,
) => {
  return new Promise<ReturnType<typeof actor.getSnapshot>>((resolve, reject) => {
    const first = actor.getSnapshot();
    if (predicate(first)) {
      resolve(first);
      return;
    }

    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`Timed out waiting for state ${JSON.stringify(actor.getSnapshot().value)}`));
    }, timeoutMs);

    const subscription = actor.subscribe((snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
      resolve(snapshot);
    });
  });
};

describe("desktopReviewSessionMachine", () => {
  it("runs happy path and completes after grading a single card", async () => {
    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem()],
        loadCard: async () => ({ prompt: "Prompt", reveal: "Reveal", cardType: "qa" }),
        scheduleReview: async () => ({ previousCard }),
        undoReview: async () => undefined,
      },
    });

    actor.start();

    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showPrompt" }));
    actor.send({ type: "REVEAL" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showAnswer" }));
    actor.send({ type: "GRADE", grade: 2 });

    const complete = await waitForSnapshot(actor, (snapshot) => snapshot.matches("complete"));
    expect(complete.context.sessionStats.reviewed).toBe(1);
    expect(complete.context.sessionStats.good).toBe(1);
    expect(complete.context.reviewLogStack).toHaveLength(1);

    actor.stop();
  });

  it("skips broken cards during loading and advances to next card", async () => {
    const loadCard = vi.fn(async ({ cardId }: { cardId: string }) => {
      if (cardId === "bad") {
        throw new RecoverableCardLoadError("broken card");
      }
      return { prompt: "Good", reveal: "Answer", cardType: "qa" as const };
    });

    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem({ cardId: "bad" }), queueItem({ cardId: "good" })],
        loadCard,
        scheduleReview: async () => ({ previousCard }),
        undoReview: async () => undefined,
      },
    });

    actor.start();

    const snapshot = await waitForSnapshot(
      actor,
      (state) => state.matches({ presenting: "showPrompt" }) && state.context.currentIndex === 1,
    );

    expect(snapshot.context.currentCard?.prompt).toBe("Good");
    expect(loadCard).toHaveBeenCalledTimes(2);

    actor.stop();
  });

  it("enters complete when all cards fail to load", async () => {
    const loadCard = vi.fn(async () => {
      throw new RecoverableCardLoadError("broken card");
    });

    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem({ cardId: "bad-1" }), queueItem({ cardId: "bad-2" })],
        loadCard,
        scheduleReview: async () => ({ previousCard }),
        undoReview: async () => undefined,
      },
    });

    actor.start();
    const complete = await waitForSnapshot(actor, (snapshot) => snapshot.matches("complete"));

    expect(loadCard).toHaveBeenCalledTimes(2);
    expect(complete.context.sessionStats.reviewed).toBe(0);

    actor.stop();
  });

  it("does not silently skip infrastructure load failures", async () => {
    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem({ cardId: "bad-1" }), queueItem({ cardId: "bad-2" })],
        loadCard: async () => {
          throw new Error("rpc transport failed");
        },
        scheduleReview: async () => ({ previousCard }),
        undoReview: async () => undefined,
      },
    });

    actor.start();
    const complete = await waitForSnapshot(actor, (snapshot) => snapshot.matches("complete"));

    expect(complete.context.currentIndex).toBe(0);
    expect(complete.context.error).toContain("rpc transport failed");

    actor.stop();
  });

  it("returns to showAnswer with error when grading fails", async () => {
    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem()],
        loadCard: async () => ({ prompt: "Prompt", reveal: "Reveal", cardType: "qa" }),
        scheduleReview: async () => {
          throw new Error("save failed");
        },
        undoReview: async () => undefined,
      },
    });

    actor.start();

    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showPrompt" }));
    actor.send({ type: "REVEAL" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showAnswer" }));
    actor.send({ type: "GRADE", grade: 2 });

    const failed = await waitForSnapshot(
      actor,
      (snapshot) =>
        snapshot.matches({ presenting: "showAnswer" }) &&
        snapshot.context.error !== null &&
        snapshot.context.pendingGrade === null,
    );

    expect(failed.context.error).toContain("save failed");

    actor.stop();
  });

  it("blocks UNDO and QUIT while grading is in flight", async () => {
    const scheduleDeferred = createDeferred<{ previousCard: SerializedItemMetadata }>();
    const undoReview = vi.fn(async () => undefined);

    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem()],
        loadCard: async () => ({ prompt: "Prompt", reveal: "Reveal", cardType: "qa" }),
        scheduleReview: async () => scheduleDeferred.promise,
        undoReview,
      },
    });

    actor.start();
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showPrompt" }));
    actor.send({ type: "REVEAL" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showAnswer" }));
    actor.send({ type: "GRADE", grade: 2 });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "grading" }));

    actor.send({ type: "UNDO" });
    actor.send({ type: "QUIT" });
    expect(actor.getSnapshot().matches({ presenting: "grading" })).toBe(true);
    expect(undoReview).not.toHaveBeenCalled();

    scheduleDeferred.resolve({ previousCard });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches("complete"));

    actor.stop();
  });

  it("supports multi-level undo across multiple graded cards", async () => {
    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem({ cardId: "card-a" }), queueItem({ cardId: "card-b" })],
        loadCard: async ({ cardId }) => ({
          prompt: `Prompt ${cardId}`,
          reveal: `Reveal ${cardId}`,
          cardType: "qa",
        }),
        scheduleReview: async () => ({ previousCard }),
        undoReview: async () => undefined,
      },
    });

    actor.start();

    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showPrompt" }));
    actor.send({ type: "REVEAL" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showAnswer" }));
    actor.send({ type: "GRADE", grade: 2 });

    await waitForSnapshot(
      actor,
      (snapshot) => snapshot.matches({ presenting: "showPrompt" }) && snapshot.context.currentIndex === 1,
    );
    actor.send({ type: "REVEAL" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showAnswer" }));
    actor.send({ type: "GRADE", grade: 1 });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches("complete"));

    actor.send({ type: "UNDO" });
    await waitForSnapshot(
      actor,
      (snapshot) => snapshot.matches({ presenting: "showPrompt" }) && snapshot.context.currentIndex === 1,
    );
    actor.send({ type: "UNDO" });
    const fullyUndone = await waitForSnapshot(
      actor,
      (snapshot) => snapshot.matches({ presenting: "showPrompt" }) && snapshot.context.currentIndex === 0,
    );

    expect(fullyUndone.context.sessionStats.reviewed).toBe(0);
    expect(fullyUndone.context.reviewLogStack).toHaveLength(0);

    actor.stop();
  });

  it("allows undo during loading to restore previous card", async () => {
    const secondCardLoad = createDeferred<{ prompt: string; reveal: string; cardType: "qa" }>();
    const undoReview = vi.fn(async () => undefined);

    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem({ cardId: "card-a" }), queueItem({ cardId: "card-b" })],
        loadCard: async ({ cardId }) => {
          if (cardId === "card-b") {
            return secondCardLoad.promise;
          }
          return { prompt: "Prompt A", reveal: "Reveal A", cardType: "qa" };
        },
        scheduleReview: async () => ({ previousCard }),
        undoReview,
      },
    });

    actor.start();

    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showPrompt" }));
    actor.send({ type: "REVEAL" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showAnswer" }));
    actor.send({ type: "GRADE", grade: 2 });
    await waitForSnapshot(
      actor,
      (snapshot) => snapshot.matches({ presenting: "loading" }) && snapshot.context.currentIndex === 1,
    );

    actor.send({ type: "UNDO" });
    const restored = await waitForSnapshot(
      actor,
      (snapshot) => snapshot.matches({ presenting: "showPrompt" }) && snapshot.context.currentIndex === 0,
    );

    expect(undoReview).toHaveBeenCalledTimes(1);
    expect(restored.context.currentCard?.prompt).toBe("Prompt A");

    secondCardLoad.resolve({ prompt: "Prompt B", reveal: "Reveal B", cardType: "qa" });
    actor.stop();
  });

  it("quits from presenting states", async () => {
    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem()],
        loadCard: async () => ({ prompt: "Prompt", reveal: "Reveal", cardType: "qa" }),
        scheduleReview: async () => ({ previousCard }),
        undoReview: async () => undefined,
      },
    });

    actor.start();
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showPrompt" }));
    actor.send({ type: "QUIT" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches("complete"));

    actor.stop();
  });

  it("allows undo from complete state and restores prior index", async () => {
    const undoReview = vi.fn(async () => undefined);

    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: [queueItem()],
        loadCard: async () => ({ prompt: "Prompt", reveal: "Reveal", cardType: "qa" }),
        scheduleReview: async () => ({ previousCard }),
        undoReview,
      },
    });

    actor.start();

    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showPrompt" }));
    actor.send({ type: "REVEAL" });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches({ presenting: "showAnswer" }));
    actor.send({ type: "GRADE", grade: 2 });
    await waitForSnapshot(actor, (snapshot) => snapshot.matches("complete"));

    actor.send({ type: "UNDO" });
    const restored = await waitForSnapshot(
      actor,
      (snapshot) => snapshot.matches({ presenting: "showPrompt" }) && snapshot.context.currentIndex === 0,
    );

    expect(undoReview).toHaveBeenCalledTimes(1);
    expect(restored.context.sessionStats.reviewed).toBe(0);
    expect(restored.context.sessionStats.good).toBe(0);

    actor.stop();
  });
});
