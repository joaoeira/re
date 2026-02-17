import { Effect, Schema } from "effect";
import { describe, it, assert } from "@effect/vitest";
import {
  NumericFieldFromString,
  StateFromString,
  LearningStepsFromString,
  LastReviewFromString,
  ItemIdSchema,
} from "../src/schema/index.ts";

describe("NumericFieldFromString", () => {
  it.scoped("parses valid integers", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("5");
      assert.strictEqual(result.value, 5);
      assert.strictEqual(result.raw, "5");
    }),
  );

  it.scoped("parses valid decimals", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("5.2");
      assert.strictEqual(result.value, 5.2);
      assert.strictEqual(result.raw, "5.2");
    }),
  );

  it.scoped("preserves trailing zeros", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("5.20");
      assert.strictEqual(result.value, 5.2);
      assert.strictEqual(result.raw, "5.20");
    }),
  );

  it.scoped("parses zero", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("0");
      assert.strictEqual(result.value, 0);
      assert.strictEqual(result.raw, "0");
    }),
  );

  it.scoped("parses zero with decimals", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("0.123");
      assert.strictEqual(result.value, 0.123);
      assert.strictEqual(result.raw, "0.123");
    }),
  );

  it.scoped("rejects negative numbers", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("-1").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects Infinity", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("Infinity").pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );

  it.scoped("rejects NaN", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("NaN").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects scientific notation", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("1e-7").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects leading dot", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)(".5").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects trailing dot", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("5.").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects trailing junk", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)("5.2x").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("encodes back to raw string", () =>
    Effect.gen(function* () {
      const field = { value: 5.2, raw: "5.20" };
      const result = yield* Schema.encode(NumericFieldFromString)(field);
      assert.strictEqual(result, "5.20");
    }),
  );

  it.scoped("rejects oversized numbers that parse to Infinity", () =>
    Effect.gen(function* () {
      // A number with 400 digits will parse to Infinity
      const hugeNumber = "1" + "0".repeat(400);
      const result = yield* Schema.decodeUnknown(NumericFieldFromString)(hugeNumber).pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );
});

describe("StateFromString", () => {
  it.scoped("parses 0 as New", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(StateFromString)("0");
      assert.strictEqual(result, 0);
    }),
  );

  it.scoped("parses 1 as Learning", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(StateFromString)("1");
      assert.strictEqual(result, 1);
    }),
  );

  it.scoped("parses 2 as Review", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(StateFromString)("2");
      assert.strictEqual(result, 2);
    }),
  );

  it.scoped("parses 3 as Relearning", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(StateFromString)("3");
      assert.strictEqual(result, 3);
    }),
  );

  it.scoped("rejects 4", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(StateFromString)("4").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects negative", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(StateFromString)("-1").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("encodes back to string", () =>
    Effect.gen(function* () {
      const result = yield* Schema.encode(StateFromString)(2);
      assert.strictEqual(result, "2");
    }),
  );
});

describe("LearningStepsFromString", () => {
  it.scoped("parses 0", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LearningStepsFromString)("0");
      assert.strictEqual(result, 0);
    }),
  );

  it.scoped("parses positive integers", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LearningStepsFromString)("42");
      assert.strictEqual(result, 42);
    }),
  );

  it.scoped("rejects negative", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LearningStepsFromString)("-1").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects decimals", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LearningStepsFromString)("1.5").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.scoped("rejects leading zeros", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LearningStepsFromString)("01").pipe(Effect.flip);
      assert.ok(result);
    }),
  );
});

describe("LastReviewFromString", () => {
  it.scoped("parses UTC timestamp", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-01-04T10:30:00Z");
      assert.ok(result instanceof Date);
      assert.strictEqual(result.toISOString(), "2025-01-04T10:30:00.000Z");
    }),
  );

  it.scoped("parses timestamp with positive offset", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-01-04T10:30:00+02:00");
      assert.ok(result instanceof Date);
      // 10:30+02:00 = 08:30 UTC
      assert.strictEqual(result.toISOString(), "2025-01-04T08:30:00.000Z");
    }),
  );

  it.scoped("parses timestamp with milliseconds", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-01-04T10:30:00.123Z");
      assert.ok(result instanceof Date);
      assert.strictEqual(result.toISOString(), "2025-01-04T10:30:00.123Z");
    }),
  );

  it.scoped("rejects timestamp without timezone", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-01-04T10:30:00").pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );

  it.scoped("encodes to UTC ISO string", () =>
    Effect.gen(function* () {
      const date = new Date("2025-01-04T10:30:00+02:00");
      const result = yield* Schema.encode(LastReviewFromString)(date);
      assert.strictEqual(result, "2025-01-04T08:30:00.000Z");
    }),
  );

  it.scoped("rejects invalid calendar date Feb 30", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-02-30T10:30:00Z").pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );

  it.scoped("rejects invalid calendar date Feb 29 in non-leap year", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-02-29T10:30:00Z").pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );

  it.scoped("accepts valid Feb 29 in leap year", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2024-02-29T10:30:00Z");
      assert.ok(result instanceof Date);
      assert.strictEqual(result.toISOString(), "2024-02-29T10:30:00.000Z");
    }),
  );

  it.scoped("rejects invalid hour 25", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-01-04T25:30:00Z").pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );

  it.scoped("rejects invalid minute 61", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-01-04T10:61:00Z").pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );

  it.scoped("rejects month 13", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(LastReviewFromString)("2025-13-04T10:30:00Z").pipe(
        Effect.flip,
      );
      assert.ok(result);
    }),
  );

  it.scoped("fails to encode invalid Date", () =>
    Effect.gen(function* () {
      const invalidDate = new Date("invalid");
      const result = yield* Schema.encode(LastReviewFromString)(invalidDate).pipe(Effect.flip);
      assert.ok(result);
    }),
  );
});

describe("ItemIdSchema", () => {
  it.scoped("accepts non-empty strings", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(ItemIdSchema)("abc123");
      assert.strictEqual(result, "abc123");
    }),
  );

  it.scoped("rejects empty strings", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(ItemIdSchema)("").pipe(Effect.flip);
      assert.ok(result);
    }),
  );
});
