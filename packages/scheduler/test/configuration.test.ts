import { describe, expect, it } from "@effect/vitest";
import { createMetadata, numericField, State, type ItemMetadata } from "@re/core";
import { Effect } from "effect";
import { default_w } from "ts-fsrs";
import { makeScheduler, makeSchedulerLayer, Scheduler, type FSRSOptions } from "../src";

const reviewedCard = (): ItemMetadata => ({
  ...createMetadata(),
  state: State.Review,
  stability: numericField(30),
  difficulty: numericField(5),
  lastReview: new Date("2026-01-01T12:00:00Z"),
  due: new Date("2026-02-01T12:00:00Z"),
});

describe("scheduler configuration", () => {
  it.effect(
    "higher retention shortens future intervals while saved deadlines and history stay intact",
    () =>
      Effect.gen(function* () {
        const standard = yield* makeScheduler();
        const higherRetention = yield* makeScheduler({ request_retention: 0.97 });
        const card = reviewedCard();
        const now = new Date("2026-01-20T12:00:00Z");

        const ordinary = yield* standard.scheduleReview(card, 2, now);
        const earlier = yield* higherRetention.scheduleReview(card, 2, now);

        expect(earlier.updatedCard.due!.getTime()).toBeLessThan(
          ordinary.updatedCard.due!.getTime(),
        );
        expect(earlier.schedulerLog.scheduledDays).toBe(31);
        expect(card.due!.toISOString()).toBe("2026-02-01T12:00:00.000Z");
      }),
  );

  it.effect("caps final intervals for well-learned cards and explicit learning delays", () =>
    Effect.gen(function* () {
      const scheduler = yield* makeScheduler({ maximum_interval: 7, learning_steps: ["30d"] });
      const card = { ...reviewedCard(), stability: numericField(1000) };
      const now = card.due!;
      for (const [input, grade] of [
        [card, 3],
        [createMetadata(), 0],
      ] as const) {
        const result = yield* scheduler.scheduleReview(input, grade, now);
        expect(result.updatedCard.due!.getTime() - now.getTime()).toBe(7 * 86_400_000);
      }
    }),
  );

  it.effect(
    "uses separate learning and relearning delays and captures each scheduler's settings",
    () =>
      Effect.gen(function* () {
        const options = {
          learning_steps: ["3m", "25m"],
          relearning_steps: ["2h"],
        } satisfies FSRSOptions;
        const original = yield* makeScheduler(options);
        options.learning_steps[0] = "25m";
        const changed = yield* makeScheduler(options);
        const now = new Date("2026-02-01T12:00:00Z");

        const again = yield* original.scheduleReview(createMetadata(), 0, now);
        const good = yield* original.scheduleReview(createMetadata(), 2, now);
        const forgotten = yield* original.scheduleReview(reviewedCard(), 0, now);
        const changedAgain = yield* changed.scheduleReview(createMetadata(), 0, now);

        expect(again.updatedCard.due!.getTime() - now.getTime()).toBe(3 * 60_000);
        expect(good.updatedCard.due!.getTime() - now.getTime()).toBe(25 * 60_000);
        expect(forgotten.updatedCard.due!.getTime() - now.getTime()).toBe(120 * 60_000);
        expect(changedAgain.updatedCard.due!.getTime() - now.getTime()).toBe(25 * 60_000);
      }),
  );

  it.effect("disabling short-term scheduling bypasses configured learning steps", () =>
    Effect.gen(function* () {
      const scheduler = yield* makeScheduler({
        enable_short_term: false,
        learning_steps: ["2h"],
      });
      const now = new Date("2026-01-01T12:00:00Z");
      const result = yield* scheduler.scheduleReview(createMetadata(), 0, now);

      expect(result.updatedCard.state).toBe(State.Review);
      expect(result.updatedCard.due!.getTime() - now.getTime()).toBeGreaterThanOrEqual(86_400_000);
    }),
  );

  it.effect("uses supplied model weights for scheduling without retaining the caller's array", () =>
    Effect.gen(function* () {
      const weights = [...default_w];
      weights[2] = 20;
      const fitted = yield* makeScheduler({ w: weights, enable_short_term: false });
      weights[2] = 50;
      const changed = yield* makeScheduler({ w: weights, enable_short_term: false });
      const standard = yield* makeScheduler({ enable_short_term: false });
      const now = new Date("2026-01-01T12:00:00Z");
      const ordinary = yield* standard.scheduleReview(createMetadata(), 2, now);
      const fittedResult = yield* fitted.scheduleReview(createMetadata(), 2, now);
      const changedResult = yield* changed.scheduleReview(createMetadata(), 2, now);

      expect(fittedResult.updatedCard.due!.getTime()).toBeGreaterThan(
        ordinary.updatedCard.due!.getTime(),
      );
      expect(fittedResult.updatedCard.due!.getTime()).toBeLessThan(
        changedResult.updatedCard.due!.getTime(),
      );
    }),
  );

  it.effect("enabling fuzz varies long intervals", () =>
    Effect.gen(function* () {
      const plain = yield* makeScheduler({ enable_fuzz: false });
      const fuzzed = yield* makeScheduler({ enable_fuzz: true });
      const differences: boolean[] = [];
      for (let day = 1; day <= 10; day++) {
        const now = new Date(`2026-02-${String(day).padStart(2, "0")}T12:00:00Z`);
        const card = reviewedCard();
        const ordinary = yield* plain.scheduleReview(card, 2, now);
        const varied = yield* fuzzed.scheduleReview(card, 2, now);
        differences.push(ordinary.updatedCard.due!.getTime() !== varied.updatedCard.due!.getTime());
      }
      expect(differences.some(Boolean)).toBe(true);
    }),
  );

  it.effect("rejects invalid settings before a dependent program starts", () =>
    Effect.gen(function* () {
      const nonFiniteWeights = [...default_w];
      nonFiniteWeights[2] = NaN;
      const invalidOptions: readonly unknown[] = [
        { request_retention: 0 },
        { request_retention: 1.1 },
        { maximum_interval: 0 },
        { maximum_interval: 1.5 },
        { maximum_interval: Infinity },
        { learning_steps: ["0m", "10m"] },
        { learning_steps: ["1.5h"] },
        { learning_steps: [`${"9".repeat(400)}m`] },
        { relearning_steps: ["9007199254740991d"] },
        { relearning_steps: ["10x"] },
        { learning_steps: "10m" },
        { enable_fuzz: "false" },
        { w: [] },
        { w: nonFiniteWeights },
        { desired_retention: 0.95 },
      ];
      for (const options of invalidOptions) {
        let started = false;
        const error = yield* Effect.gen(function* () {
          const scheduler = yield* Scheduler;
          started = true;
          return yield* scheduler.scheduleReview(createMetadata(), 2, new Date());
        }).pipe(Effect.provide(makeSchedulerLayer(options as FSRSOptions)), Effect.flip);

        expect(error).toMatchObject({ _tag: "SchedulerConfigError" });
        expect(started).toBe(false);
      }
    }),
  );
});
