import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { validateReviewAnalyticsMigrationKeys } from "@main/analytics/migrations";
import type * as SqlClient from "@effect/sql/SqlClient";

const migration = Effect.void as Effect.Effect<void, unknown, SqlClient.SqlClient>;

describe("analytics migration key validation", () => {
  it("fails when migration key format is invalid", async () => {
    const exit = await Effect.runPromiseExit(
      validateReviewAnalyticsMigrationKeys({
        bad_key: migration,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected migration validation to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value.reason).toBe("bad-state");
    }
  });

  it("fails when duplicate migration ids are present", async () => {
    const exit = await Effect.runPromiseExit(
      validateReviewAnalyticsMigrationKeys({
        "0001_create_a": migration,
        "0001_create_b": migration,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected migration validation to fail on duplicate ids.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value.reason).toBe("bad-state");
    }
  });
});
