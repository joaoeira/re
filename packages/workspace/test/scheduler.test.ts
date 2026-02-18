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
  it("getReviewDate prefers stored due over legacy reconstruction", async () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const storedDue = new Date("2025-01-05T00:00:00Z");
    const card = makeCard({
      state: State.Review,
      stability: 100,
      lastReview: now,
      due: storedDue,
    });

    const due = await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      return scheduler.getReviewDate(card);
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);

    expect(due?.toISOString()).toBe(storedDue.toISOString());
  });

  it("falls back to legacy reconstruction when due is missing", async () => {
    const now = new Date("2025-01-04T12:00:00Z");
    const lastReview = new Date("2025-01-01T12:00:00Z");
    const card = makeCard({
      state: State.Review,
      stability: 2,
      lastReview,
      due: null,
    });

    const isDue = await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      return scheduler.isDue(card, now);
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);

    expect(isDue).toBe(true);
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

  it("isDue follows stored due semantics for migrated cards", async () => {
    const now = new Date("2025-01-10T00:00:00Z");
    const card = makeCard({
      state: State.Review,
      stability: 30,
      lastReview: new Date("2025-01-09T00:00:00Z"),
      due: new Date("2025-01-08T00:00:00Z"),
    });

    const isDue = await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      return scheduler.isDue(card, now);
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);

    expect(isDue).toBe(true);
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
