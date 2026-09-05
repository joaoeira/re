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

import { Scheduler, SchedulerLive, isCardDue, resolveDueDateIfDue } from "../src";

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
  it("isCardDue matches SchedulerLive.isDue across representative states", async () => {
    const now = new Date("2025-01-10T12:00:00Z");
    const cases = [
      makeCard({ state: State.New, lastReview: null, due: null }),
      makeCard({
        state: State.Review,
        stability: 2,
        lastReview: new Date("2025-01-01T12:00:00Z"),
        due: null,
      }),
      makeCard({
        state: State.Review,
        stability: 20,
        lastReview: new Date("2025-01-09T12:00:00Z"),
        due: null,
      }),
      makeCard({
        state: State.Relearning,
        learningSteps: 0,
        lastReview: new Date("2025-01-10T12:05:00Z"),
        due: null,
      }),
      makeCard({
        state: State.Review,
        stability: 1,
        lastReview: null,
        due: new Date("2025-01-10T11:00:00Z"),
      }),
      makeCard({
        state: State.Review,
        stability: 1,
        lastReview: null,
        due: null,
      }),
    ];

    await Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      for (const card of cases) {
        expect(isCardDue(card, now)).toBe(scheduler.isDue(card, now));
      }
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise);
  });

  it("treats dueDate equal to asOf as due", () => {
    const asOf = new Date("2025-01-10T00:00:00Z");
    const card = makeCard({
      state: State.Review,
      stability: 30,
      lastReview: new Date("2025-01-09T00:00:00Z"),
      due: new Date("2025-01-10T00:00:00Z"),
    });

    expect(isCardDue(card, asOf)).toBe(true);
    expect(resolveDueDateIfDue(card, asOf)?.toISOString()).toBe(asOf.toISOString());
  });

  it("returns not due for non-new cards missing both lastReview and due", () => {
    const card = makeCard({
      state: State.Review,
      stability: 10,
      lastReview: null,
      due: null,
    });
    const now = new Date("2025-01-10T00:00:00Z");

    expect(isCardDue(card, now)).toBe(false);
    expect(resolveDueDateIfDue(card, now)).toBeNull();
  });

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
