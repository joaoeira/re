import { Effect, Schema } from "effect";
import { describe, it, assert } from "@effect/vitest";
import {
  NumericFieldFromString,
  StateFromString,
  LearningStepsFromString,
  LastReviewFromString,
  ItemIdSchema,
} from "../../src/core/schema/index.ts";

describe("NumericFieldFromString", () => {
  it.effect("parses valid integers", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("5");
      assert.strictEqual(result.value, 5);
      assert.strictEqual(result.raw, "5");
    }),
  );

  it.effect("parses valid decimals", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("5.2");
      assert.strictEqual(result.value, 5.2);
      assert.strictEqual(result.raw, "5.2");
    }),
  );

  it.effect("preserves trailing zeros", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("5.20");
      assert.strictEqual(result.value, 5.2);
      assert.strictEqual(result.raw, "5.20");
    }),
  );

  it.effect("parses zero", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("0");
      assert.strictEqual(result.value, 0);
      assert.strictEqual(result.raw, "0");
    }),
  );

  it.effect("parses zero with decimals", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("0.123");
      assert.strictEqual(result.value, 0.123);
      assert.strictEqual(result.raw, "0.123");
    }),
  );

  it.effect("rejects negative numbers", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("-1").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects Infinity", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("Infinity").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects NaN", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("NaN").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects scientific notation", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("1e-7").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects leading dot", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)(".5").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects trailing dot", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("5.").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects trailing junk", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)("5.2x").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("encodes back to raw string", () =>
    Effect.gen(function* () {
      const field = { value: 5.2, raw: "5.20" };
      const result = yield* Schema.encodeEffect(NumericFieldFromString)(field);
      assert.strictEqual(result, "5.20");
    }),
  );

  it.effect("rejects oversized numbers that parse to Infinity", () =>
    Effect.gen(function* () {
      // A number with 400 digits will parse to Infinity
      const hugeNumber = "1" + "0".repeat(400);

      const result = yield* Schema.decodeUnknownEffect(NumericFieldFromString)(hugeNumber).pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );
});

describe("StateFromString", () => {
  it.effect("parses 0 as New", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(StateFromString)("0");
      assert.strictEqual(result, 0);
    }),
  );

  it.effect("parses 1 as Learning", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(StateFromString)("1");
      assert.strictEqual(result, 1);
    }),
  );

  it.effect("parses 2 as Review", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(StateFromString)("2");
      assert.strictEqual(result, 2);
    }),
  );

  it.effect("parses 3 as Relearning", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(StateFromString)("3");
      assert.strictEqual(result, 3);
    }),
  );

  it.effect("rejects 4", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(StateFromString)("4").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.effect("rejects negative", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(StateFromString)("-1").pipe(Effect.flip);
      assert.ok(result);
    }),
  );

  it.effect("encodes back to string", () =>
    Effect.gen(function* () {
      const result = yield* Schema.encodeEffect(StateFromString)(2);
      assert.strictEqual(result, "2");
    }),
  );
});

describe("LearningStepsFromString", () => {
  it.effect("preserves the safe-integer boundary when decoding and encoding learning steps", () =>
    Effect.gen(function* () {
      const maximum = Number.MAX_SAFE_INTEGER;
      assert.strictEqual(
        yield* Schema.decodeUnknownEffect(LearningStepsFromString)(String(maximum)),
        maximum,
      );
      assert.strictEqual(
        yield* Schema.encodeEffect(LearningStepsFromString)(maximum),
        String(maximum),
      );

      const overflow = yield* Schema.decodeUnknownEffect(LearningStepsFromString)(
        "9007199254740992",
      ).pipe(Effect.flip);

      assert.strictEqual(overflow._tag, "SchemaError");

      for (const invalid of [-1, 1.5, maximum + 1, Infinity, NaN]) {
        const error = yield* Schema.encodeEffect(LearningStepsFromString)(invalid).pipe(
          Effect.flip,
        );

        assert.strictEqual(error._tag, "SchemaError");
      }
    }),
  );

  it.effect("parses 0", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LearningStepsFromString)("0");
      assert.strictEqual(result, 0);
    }),
  );

  it.effect("parses positive integers", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LearningStepsFromString)("42");
      assert.strictEqual(result, 42);
    }),
  );

  it.effect("rejects negative", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LearningStepsFromString)("-1").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects decimals", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LearningStepsFromString)("1.5").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );

  it.effect("rejects leading zeros", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LearningStepsFromString)("01").pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );
});

describe("LastReviewFromString", () => {
  it.effect("parses UTC timestamp", () =>
    Effect.gen(function* () {
      const result =
        yield* Schema.decodeUnknownEffect(LastReviewFromString)("2025-01-04T10:30:00Z");

      assert.ok(result instanceof Date);
      assert.strictEqual(result.toISOString(), "2025-01-04T10:30:00.000Z");
    }),
  );

  it.effect("parses timestamp with positive offset", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-01-04T10:30:00+02:00",
      );

      assert.ok(result instanceof Date);
      // 10:30+02:00 = 08:30 UTC
      assert.strictEqual(result.toISOString(), "2025-01-04T08:30:00.000Z");
    }),
  );

  it.effect("parses timestamp with milliseconds", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-01-04T10:30:00.123Z",
      );

      assert.ok(result instanceof Date);
      assert.strictEqual(result.toISOString(), "2025-01-04T10:30:00.123Z");
    }),
  );

  it.effect("rejects timestamp without timezone", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-01-04T10:30:00",
      ).pipe(Effect.flip);

      assert.ok(result);
    }),
  );

  it.effect("encodes to UTC ISO string", () =>
    Effect.gen(function* () {
      const date = new Date("2025-01-04T10:30:00+02:00");
      const result = yield* Schema.encodeEffect(LastReviewFromString)(date);
      assert.strictEqual(result, "2025-01-04T08:30:00.000Z");
    }),
  );

  it.effect("rejects invalid calendar date Feb 30", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-02-30T10:30:00Z",
      ).pipe(Effect.flip);

      assert.ok(result);
    }),
  );

  it.effect("rejects invalid calendar date Feb 30 with offset", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-02-30T10:30:00+02:00",
      ).pipe(Effect.flip);

      assert.ok(result);
    }),
  );

  it.effect("rejects invalid calendar date Feb 29 in non-leap year", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-02-29T10:30:00Z",
      ).pipe(Effect.flip);

      assert.ok(result);
    }),
  );

  it.effect("accepts valid Feb 29 in leap year", () =>
    Effect.gen(function* () {
      const result =
        yield* Schema.decodeUnknownEffect(LastReviewFromString)("2024-02-29T10:30:00Z");

      assert.ok(result instanceof Date);
      assert.strictEqual(result.toISOString(), "2024-02-29T10:30:00.000Z");
    }),
  );

  it.effect("rejects invalid hour 25", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-01-04T25:30:00Z",
      ).pipe(Effect.flip);

      assert.ok(result);
    }),
  );

  it.effect("rejects invalid minute 61", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-01-04T10:61:00Z",
      ).pipe(Effect.flip);

      assert.ok(result);
    }),
  );

  it.effect("rejects month 13", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(LastReviewFromString)(
        "2025-13-04T10:30:00Z",
      ).pipe(Effect.flip);

      assert.ok(result);
    }),
  );

  it.effect("fails to encode invalid Date", () =>
    Effect.gen(function* () {
      const invalidDate = new Date("invalid");

      const result = yield* Schema.encodeEffect(LastReviewFromString)(invalidDate).pipe(
        Effect.flip,
      );

      assert.ok(result);
    }),
  );
});

describe("ItemIdSchema", () => {
  it.effect("accepts non-empty strings", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(ItemIdSchema)("abc123");
      assert.strictEqual(result, "abc123");
    }),
  );

  it.effect("rejects empty strings", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(ItemIdSchema)("").pipe(Effect.flip);
      assert.ok(result);
    }),
  );
});
