import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  State,
  generateId,
  numericField,
  parseFile,
  serializeMetadata,
  type ItemId,
  type ItemMetadata,
} from "@re/core";

import { Scheduler, SchedulerLive } from "../src";

const makeCard = (input: {
  readonly state: State;
  readonly stability?: number;
  readonly difficulty?: number;
  readonly learningSteps?: number;
  readonly lastReview?: Date | null;
  readonly due?: Date | null;
}): ItemMetadata => ({
  id: generateId() as ItemId,
  stability: numericField(input.stability ?? 0),
  difficulty: numericField(input.difficulty ?? 5),
  state: input.state,
  learningSteps: input.learningSteps ?? 0,
  lastReview: input.lastReview ?? null,
  due: input.due ?? null,
});

describe("Scheduler", () => {
  it("selects due cards by their stored deadline, excluding new and unscheduled cards", async () => {
    const now = new Date("2025-01-10T12:00:00Z");
    const lastReview = new Date("2025-01-01T12:00:00Z");
    const cards = {
      overdue: makeCard({ state: State.Review, stability: 100, lastReview, due: lastReview }),
      atBoundary: makeCard({ state: State.Learning, lastReview, due: now }),
      future: makeCard({
        state: State.Relearning,
        lastReview,
        due: new Date("2025-01-11T12:00:00Z"),
      }),
      unscheduledReview: makeCard({ state: State.Review, stability: 2, lastReview }),
      unscheduledLearning: makeCard({ state: State.Learning, lastReview }),
      unscheduledRelearning: makeCard({ state: State.Relearning, lastReview }),
      new: makeCard({ state: State.New, due: lastReview }),
    };

    const dueNames = await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      return Object.entries(cards)
        .filter(([, card]) => scheduler.isDue(card, now))
        .map(([name]) => name);
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);

    expect(dueNames).toEqual(["overdue", "atBoundary"]);
  });

  it("fails a review with incomplete timestamps instead of inventing scheduling history", async () => {
    const now = new Date("2025-01-10T12:00:00Z");
    const previous = new Date("2025-01-01T12:00:00Z");
    await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      for (const timestamps of [
        { lastReview: previous, due: null },
        { lastReview: null, due: previous },
      ]) {
        const card = makeCard({ state: State.Review, stability: 2, ...timestamps });
        const error = yield* scheduler.scheduleReview(card, 2, now).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "ScheduleError", cardId: card.id });
      }
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);
  });

  it("persists fsrs-computed due when scheduling a review", async () => {
    const now = new Date("2025-01-10T12:00:00Z");
    const card = makeCard({
      state: State.New,
      due: null,
      lastReview: null,
    });

    const result = await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      return yield* scheduler.scheduleReview(card, 2, now);
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);

    expect(result.updatedCard.lastReview?.toISOString()).toBe(now.toISOString());
    expect(result.updatedCard.due).not.toBeNull();
    expect(result.updatedCard.due!.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("round-trips scheduled due through serializer and parser", async () => {
    const now = new Date("2025-01-10T12:00:00Z");
    const card = makeCard({
      state: State.New,
      due: null,
      lastReview: null,
    });

    const scheduled = await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      return yield* scheduler.scheduleReview(card, 2, now);
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);

    const serialized = `${serializeMetadata(scheduled.updatedCard)}
Question
---
Answer
`;

    const parsed = await Effect.runPromise(parseFile(serialized));
    const roundTripped = parsed.items[0]!.cards[0]!;

    expect(roundTripped.due?.toISOString()).toBe(scheduled.updatedCard.due?.toISOString());
  });
});
