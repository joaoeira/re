import { Schema } from "@effect/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REVIEW_SESSION_OPTIONS,
  ReviewSessionOptionsSchema,
  decodeReviewSessionOptionsFromSearch,
  encodeReviewSessionOptionsForSearch,
  isDefaultReviewSessionOptions,
  reviewSessionOptionsCacheKey,
  SerializedItemMetadataSchema,
} from "@shared/rpc/schemas/review";

const baseWireMetadata = {
  id: "card-id",
  stability: { value: 5.2, raw: "5.20" },
  difficulty: { value: 2.3, raw: "2.30" },
  state: 2 as const,
  learningSteps: 0,
  lastReview: "2025-01-04T10:30:00Z",
  due: "2025-01-05T10:30:00Z",
};

describe("SerializedItemMetadataSchema", () => {
  it("round-trips metadata with strict date decoding and numeric raw preservation", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(SerializedItemMetadataSchema)(baseWireMetadata),
    );
    const encoded = await Effect.runPromise(Schema.encode(SerializedItemMetadataSchema)(decoded));

    expect(encoded.stability.raw).toBe("5.20");
    expect(encoded.difficulty.raw).toBe("2.30");
    expect(encoded.lastReview).toBe("2025-01-04T10:30:00.000Z");
    expect(encoded.due).toBe("2025-01-05T10:30:00.000Z");
  });

  it("rejects timestamps without timezone", async () => {
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknown(SerializedItemMetadataSchema)({
        ...baseWireMetadata,
        lastReview: "2025-01-04T10:30:00",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected decode failure for timestamp without timezone.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
  });

  it("rejects invalid calendar dates", async () => {
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknown(SerializedItemMetadataSchema)({
        ...baseWireMetadata,
        due: "2025-02-30T10:30:00Z",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected decode failure for invalid calendar date.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
  });

  it("rejects invalid calendar dates with offsets", async () => {
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknown(SerializedItemMetadataSchema)({
        ...baseWireMetadata,
        due: "2025-02-30T10:30:00+02:00",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected decode failure for invalid offset calendar date.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
  });
});

describe("ReviewSessionOptions", () => {
  it("round-trips the review session option schema", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(ReviewSessionOptionsSchema)({
        includeNew: false,
        includeDue: true,
        cardLimit: 100,
        order: "due-first",
      }),
    );

    const encoded = await Effect.runPromise(Schema.encode(ReviewSessionOptionsSchema)(decoded));

    expect(encoded).toEqual({
      includeNew: false,
      includeDue: true,
      cardLimit: 100,
      order: "due-first",
    });
  });

  it("omits defaults when encoding review session options for the URL", () => {
    expect(encodeReviewSessionOptionsForSearch(DEFAULT_REVIEW_SESSION_OPTIONS)).toEqual({});
    expect(isDefaultReviewSessionOptions(DEFAULT_REVIEW_SESSION_OPTIONS)).toBe(true);
    expect(reviewSessionOptionsCacheKey(DEFAULT_REVIEW_SESSION_OPTIONS)).toBe("default");
  });

  it("decodes partial search params into canonical options", () => {
    expect(
      decodeReviewSessionOptionsFromSearch({
        includeNew: "false",
        limit: "50",
        order: "new-first",
      }),
    ).toEqual({
      includeNew: false,
      includeDue: true,
      cardLimit: 50,
      order: "new-first",
    });
  });

  it("normalizes invalid empty include search params back to defaults", () => {
    expect(
      decodeReviewSessionOptionsFromSearch({
        includeNew: false,
        includeDue: false,
        limit: "-1",
        order: "unsupported",
      }),
    ).toEqual(DEFAULT_REVIEW_SESSION_OPTIONS);
  });
});
