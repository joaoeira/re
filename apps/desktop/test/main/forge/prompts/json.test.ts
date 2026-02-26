import { Schema } from "@effect/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  PromptOutputParseError,
  PromptOutputValidationError,
  decodeJsonToSchema,
} from "@main/forge/prompts";

const TopicsSchema = Schema.Struct({
  topics: Schema.Array(Schema.String),
});

const getFailure = <A, E>(exit: Exit.Exit<A, E>): E => {
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure exit.");
  }

  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "None") {
    throw new Error("Expected failure cause.");
  }

  return failure.value;
};

describe("decodeJsonToSchema", () => {
  it("decodes strict JSON", async () => {
    const result = await Effect.runPromise(
      decodeJsonToSchema(TopicsSchema, '{"topics":["math","science"]}', "forge/get-topics"),
    );

    expect(result).toEqual({
      topics: ["math", "science"],
    });
  });

  it("decodes wrapped JSON via extraction fallback", async () => {
    const result = await Effect.runPromise(
      decodeJsonToSchema(
        TopicsSchema,
        'Here is the result:\n```json\n{"topics":["history","biology"]}\n```',
        "forge/get-topics",
      ),
    );

    expect(result).toEqual({
      topics: ["history", "biology"],
    });
  });

  it("returns parse error on malformed JSON", async () => {
    const exit = await Effect.runPromiseExit(
      decodeJsonToSchema(TopicsSchema, '{"topics":["math",}', "forge/get-topics"),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptOutputParseError);
    if (failure instanceof PromptOutputParseError) {
      expect(failure.promptId).toBe("forge/get-topics");
      expect(failure.rawExcerpt.length).toBeLessThanOrEqual(500);
    }
  });

  it("returns validation error on schema mismatch", async () => {
    const exit = await Effect.runPromiseExit(
      decodeJsonToSchema(TopicsSchema, '{"topics":[1,2,3]}', "forge/get-topics"),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptOutputValidationError);
    if (failure instanceof PromptOutputValidationError) {
      expect(failure.promptId).toBe("forge/get-topics");
      expect(failure.rawExcerpt.length).toBeLessThanOrEqual(500);
    }
  });

  it("does not run extraction fallback when top-level JSON is valid but shape is wrong", async () => {
    const exit = await Effect.runPromiseExit(
      decodeJsonToSchema(TopicsSchema, '[{"topics":["nested"]}]', "forge/get-topics"),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptOutputValidationError);
  });
});
