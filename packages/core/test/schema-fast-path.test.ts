import { Either, Schema } from "effect";
import { describe, it, assert } from "@effect/vitest";
import {
  NumericFieldFromString,
  decodeNumericField,
  StateFromString,
  decodeState,
  LearningStepsFromString,
  decodeLearningSteps,
  LastReviewFromString,
  decodeLastReview,
  ItemIdSchema,
  isItemId,
} from "../src/schema/index.ts";

/**
 * The parser's fast path (decode* functions) bypasses Schema validation, so
 * parser correctness depends on each fast decoder accepting and rejecting
 * exactly the same inputs as its schema. These differential tests enforce that
 * invariant over boundary-heavy input tables: any divergence introduced in
 * either implementation fails here.
 */

const runDifferential = <A>(
  inputs: readonly string[],
  schema: Schema.Schema<A, string>,
  decode: (s: string) => A | null,
  assertSameValue: (schemaValue: A, fastValue: A, input: string) => void,
): void => {
  for (const input of inputs) {
    const schemaResult = Schema.decodeUnknownEither(schema)(input);
    const fastValue = decode(input);
    assert.strictEqual(
      fastValue !== null,
      Either.isRight(schemaResult),
      `fast path (${fastValue !== null ? "accepts" : "rejects"}) and schema (${
        Either.isRight(schemaResult) ? "accepts" : "rejects"
      }) disagree on ${JSON.stringify(input)}`,
    );
    if (fastValue !== null && Either.isRight(schemaResult)) {
      assertSameValue(schemaResult.right, fastValue, input);
    }
  }
};

const NUMERIC_CASES = [
  "0",
  "5",
  "5.2",
  "5.20",
  "0.123",
  "10.000",
  "42",
  "999999999",
  "123456789.987654321",
  "9".repeat(400),
  "00",
  "01",
  "007",
  "-1",
  "-0.5",
  "1e-7",
  "1E7",
  ".5",
  "5.",
  "5..2",
  "5.2.3",
  "5.2x",
  "x5",
  "Infinity",
  "NaN",
  "",
  " 5",
  "5 ",
  " ",
  "+5",
  "0x10",
  "1_000",
  "5,2",
] as const;

const STATE_CASES = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "9",
  "-1",
  "03",
  "00",
  "",
  "2.0",
  " 2",
  "2 ",
  "10",
  "x",
] as const;

const LEARNING_STEPS_CASES = [
  "0",
  "1",
  "2",
  "42",
  "100",
  "9007199254740991",
  "9007199254740992",
  "9007199254740993",
  "99999999999999999999999",
  "-1",
  "1.5",
  "01",
  "007",
  "",
  " 1",
  "1 ",
  "+1",
  "1e2",
  "x",
] as const;

const TIMESTAMP_CASES = [
  "2025-01-04T10:30:00Z",
  "2025-01-04T10:30:00.123Z",
  "2025-01-04T10:30:00.000Z",
  "2025-01-04T10:30:00+02:00",
  "2025-01-04T10:30:00-05:30",
  "2024-02-29T00:00:00Z",
  "2023-02-29T00:00:00Z",
  "2025-02-30T10:00:00Z",
  "2025-04-31T00:00:00Z",
  "2025-13-01T00:00:00Z",
  "2025-00-10T00:00:00Z",
  "2025-01-00T00:00:00Z",
  "2025-01-04T24:00:00Z",
  "2025-01-04T10:60:00Z",
  "2025-01-04T10:30:60Z",
  "2025-01-04T10:30:00",
  "2025-01-04 10:30:00Z",
  "2025-01-04",
  "2025-1-04T10:30:00Z",
  "2025-01-04T10:30:00+0200",
  "2025-01-04t10:30:00Z",
  "2025-01-04T10:30:00z",
  "0000-01-01T00:00:00Z",
  "9999-12-31T23:59:59Z",
  "",
] as const;

const ITEM_ID_CASES = ["", "a", "item-1", "V1StGXR8_Z5jdHi6B-myT", " ", "0"] as const;

describe("fast-path decoders match their schemas", () => {
  it("decodeNumericField matches NumericFieldFromString", () => {
    runDifferential(NUMERIC_CASES, NumericFieldFromString, decodeNumericField, (a, b, input) =>
      assert.deepStrictEqual(b, a, `decoded values differ for ${JSON.stringify(input)}`),
    );
  });

  it("decodeState matches StateFromString", () => {
    runDifferential(STATE_CASES, StateFromString, decodeState, (a, b, input) =>
      assert.strictEqual(b, a, `decoded values differ for ${JSON.stringify(input)}`),
    );
  });

  it("decodeLearningSteps matches LearningStepsFromString", () => {
    runDifferential(
      LEARNING_STEPS_CASES,
      LearningStepsFromString,
      decodeLearningSteps,
      (a, b, input) =>
        assert.strictEqual(b, a, `decoded values differ for ${JSON.stringify(input)}`),
    );
  });

  it("decodeLastReview matches LastReviewFromString", () => {
    runDifferential(TIMESTAMP_CASES, LastReviewFromString, decodeLastReview, (a, b, input) =>
      assert.strictEqual(
        b.getTime(),
        a.getTime(),
        `decoded instants differ for ${JSON.stringify(input)}`,
      ),
    );
  });

  it("isItemId matches ItemIdSchema", () => {
    runDifferential(
      ITEM_ID_CASES,
      ItemIdSchema,
      (s) => (isItemId(s) ? s : null),
      (a, b, input) =>
        assert.strictEqual(b, a, `decoded values differ for ${JSON.stringify(input)}`),
    );
  });
});
