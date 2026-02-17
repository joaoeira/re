import { describe, it, expect } from "vitest";
import { createActor, fromPromise, waitFor } from "xstate";
import { reviewSessionMachine } from "../../src/machines/reviewSession";
import { State, numericField, generateId } from "@re/core";
import type { ItemMetadata, ItemId, Item } from "@re/core";
import type { QueueItem } from "../../src/services/ReviewQueue";
import type { FSRSGrade, ReviewLogEntry } from "../../src/services/Scheduler";

const makeCard = (state: number, stability: number, lastReview: Date | null): ItemMetadata => ({
  id: generateId() as ItemId,
  stability: numericField(stability),
  difficulty: numericField(5),
  state: state as 0 | 1 | 2 | 3,
  learningSteps: 0,
  lastReview,
});

const makeQueueItem = (itemIndex: number, cardIndex = 0): QueueItem => {
  const card = makeCard(State.New, 0, null);
  const item: Item = {
    cards: [card],
    content: "Test question\n---\nTest answer",
  };
  return {
    deckPath: "/test/deck.md",
    deckName: "Test Deck",
    relativePath: "deck.md",
    item,
    card,
    cardIndex,
    itemIndex,
    category: "new",
    dueDate: null,
  };
};

// Mock grading actor that returns immediately
const mockGradingActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      queueItem: QueueItem;
      queueIndex: number;
      grade: FSRSGrade;
      runtime: unknown;
    };
  }) => ({
    schedulerLog: {
      rating: input.grade,
      previousState: input.queueItem.card.state,
      previousCard: input.queueItem.card,
      due: new Date(),
      stability: 1,
      difficulty: 5,
      scheduledDays: 1,
      learningSteps: 0,
      review: new Date(),
    },
    queueIndex: input.queueIndex,
    deckPath: input.queueItem.deckPath,
    itemIndex: input.queueItem.itemIndex,
    cardIndex: input.queueItem.cardIndex,
  }),
);

// Mock undo actor that returns the queueIndex
const mockUndoActor = fromPromise(
  async ({ input }: { input: { reviewLog: ReviewLogEntry; runtime: unknown } }) =>
    input.reviewLog.queueIndex,
);

const createTestMachine = () =>
  reviewSessionMachine.provide({
    actors: {
      grading: mockGradingActor,
      undo: mockUndoActor,
    },
  });

describe("reviewSessionMachine", () => {
  describe("basic flow", () => {
    it("starts in idle state", () => {
      const queue = [makeQueueItem(0)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();

      expect(actor.getSnapshot().value).toBe("idle");
    });

    it("transitions to presenting on START", () => {
      const queue = [makeQueueItem(0)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });

      expect(actor.getSnapshot().value).toEqual({ presenting: "showPrompt" });
    });

    it("reveals answer on REVEAL", () => {
      const queue = [makeQueueItem(0)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });

      expect(actor.getSnapshot().value).toEqual({ presenting: "showAnswer" });
      expect(actor.getSnapshot().context.isRevealed).toBe(true);
    });
  });

  describe("grading", () => {
    it("updates session stats on grade", async () => {
      const queue = [makeQueueItem(0), makeQueueItem(1)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 }); // Good

      // Wait for grading to complete
      await waitFor(actor, (state) => state.matches({ presenting: "showPrompt" }));

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.sessionStats.reviewed).toBe(1);
      expect(snapshot.context.sessionStats.good).toBe(1);
      expect(snapshot.context.currentIndex).toBe(1);
    });

    it("completes session after last card", async () => {
      const queue = [makeQueueItem(0)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 });

      await waitFor(actor, (state) => state.matches("complete"));

      expect(actor.getSnapshot().value).toBe("complete");
    });
  });

  describe("undo", () => {
    it("cannot undo without previous reviews", () => {
      const queue = [makeQueueItem(0)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });

      // UNDO should not work - no previous reviews
      expect(actor.getSnapshot().can({ type: "UNDO" })).toBe(false);
    });

    it("can undo after grading", async () => {
      const queue = [makeQueueItem(0), makeQueueItem(1)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 });

      await waitFor(actor, (state) => state.matches({ presenting: "showPrompt" }));

      expect(actor.getSnapshot().can({ type: "UNDO" })).toBe(true);
    });

    it("undo decrements session stats", async () => {
      const queue = [makeQueueItem(0), makeQueueItem(1)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 }); // Good

      await waitFor(actor, (state) => state.matches({ presenting: "showPrompt" }));

      // Verify stats before undo
      expect(actor.getSnapshot().context.sessionStats.reviewed).toBe(1);
      expect(actor.getSnapshot().context.sessionStats.good).toBe(1);

      actor.send({ type: "UNDO" });

      await waitFor(actor, (state) => state.matches({ presenting: "showPrompt" }));

      // Verify stats after undo
      const snapshot = actor.getSnapshot();
      expect(snapshot.context.sessionStats.reviewed).toBe(0);
      expect(snapshot.context.sessionStats.good).toBe(0);
      expect(snapshot.context.currentIndex).toBe(0);
    });

    it("undo from complete state navigates to correct card", async () => {
      const queue = [makeQueueItem(0)];
      const actor = createActor(createTestMachine(), {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 });

      await waitFor(actor, (state) => state.matches("complete"));

      actor.send({ type: "UNDO" });

      await waitFor(actor, (state) => state.matches({ presenting: "showPrompt" }));

      expect(actor.getSnapshot().context.currentIndex).toBe(0);
    });
  });

  describe("blocking during grading", () => {
    it("does not allow QUIT during grading", async () => {
      // Create a slow grading actor to test blocking
      const slowGradingActor = fromPromise(async ({ input }: { input: unknown }) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const i = input as { queueItem: QueueItem; queueIndex: number; grade: FSRSGrade };
        return {
          schedulerLog: {
            rating: i.grade,
            previousState: i.queueItem.card.state,
            previousCard: i.queueItem.card,
            due: new Date(),
            stability: 1,
            difficulty: 5,
            scheduledDays: 1,
            learningSteps: 0,
            review: new Date(),
          },
          queueIndex: i.queueIndex,
          deckPath: i.queueItem.deckPath,
          itemIndex: i.queueItem.itemIndex,
          cardIndex: i.queueItem.cardIndex,
        };
      });

      const slowMachine = reviewSessionMachine.provide({
        actors: {
          grading: slowGradingActor,
          undo: mockUndoActor,
        },
      });

      const queue = [makeQueueItem(0), makeQueueItem(1)];
      const actor = createActor(slowMachine, {
        input: { queue, runtime: {} as never },
      });
      actor.start();
      actor.send({ type: "START" });
      actor.send({ type: "REVEAL" });
      actor.send({ type: "GRADE", grade: 2 });

      // Should be in grading state
      expect(actor.getSnapshot().value).toEqual({ presenting: "grading" });

      // QUIT should not be allowed during grading
      expect(actor.getSnapshot().can({ type: "QUIT" })).toBe(false);
      expect(actor.getSnapshot().can({ type: "UNDO" })).toBe(false);
    });
  });
});
