import { Schema } from "@effect/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { AiMessagesSchema, ModelIdSchema } from "@shared/rpc/schemas/ai";

describe("ModelIdSchema", () => {
  it("accepts provider:model identifiers", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(ModelIdSchema)("anthropic:claude-sonnet-4-20250514"),
    );

    expect(decoded).toBe("anthropic:claude-sonnet-4-20250514");
  });

  for (const invalid of ["", "anthropic", ":model", "123:model"]) {
    it(`rejects malformed model id: ${invalid || "<empty>"}`, async () => {
      const exit = await Effect.runPromiseExit(Schema.decodeUnknown(ModelIdSchema)(invalid));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error(`Expected ModelIdSchema to reject "${invalid}".`);
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
    });
  }
});

describe("AiMessagesSchema", () => {
  it("accepts mixed string and text-part message content", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(AiMessagesSchema)([
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      ]),
    );

    expect(decoded).toHaveLength(2);
    expect(decoded[0]).toEqual({ role: "user", content: "hello" });
  });

  it("rejects empty messages arrays", async () => {
    const exit = await Effect.runPromiseExit(Schema.decodeUnknown(AiMessagesSchema)([]));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected AiMessagesSchema to reject empty arrays.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
  });

  it("rejects unsupported roles", async () => {
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknown(AiMessagesSchema)([{ role: "system", content: "nope" }]),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected AiMessagesSchema to reject unsupported roles.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
  });
});
