import { Cause, Effect, Exit, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { AiClient } from "@main/ai/ai-client";
import { AiClientServiceLive } from "@main/di";
import { createAiStreamHandlers } from "@main/rpc/handlers/ai";
import { AiProviderNotSupportedError, AiRateLimitError } from "@shared/rpc/schemas/ai";

describe("AI stream handlers", () => {
  it("maps string deltas from AiClient into chunk objects", async () => {
    const mockAiClient: AiClient = {
      streamCompletion: ({ prompt }) => Stream.fromIterable(prompt.split(" ")),
    };

    const streamHandlers = Effect.runSync(
      createAiStreamHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const chunks = await Effect.runPromise(
      streamHandlers.StreamCompletion({
        model: "anthropic:claude-sonnet-4-20250514",
        prompt: "hello world",
      }).pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual([{ delta: "hello" }, { delta: "world" }]);
  });

  it("preserves typed stream errors", async () => {
    const mockAiClient: AiClient = {
      streamCompletion: () =>
        Stream.fail(new AiRateLimitError({ message: "rate limited", retryAfterMs: 1000 })),
    };

    const streamHandlers = Effect.runSync(
      createAiStreamHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      streamHandlers.StreamCompletion({
        model: "anthropic:claude-sonnet-4-20250514",
        prompt: "hello",
      }).pipe(Stream.runCollect),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected stream handler to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(AiRateLimitError);
    }
  });

  it("preserves ai_provider_not_supported stream errors", async () => {
    const mockAiClient: AiClient = {
      streamCompletion: () => Stream.fail(new AiProviderNotSupportedError({ model: "constructor:gpt-4o" })),
    };

    const streamHandlers = Effect.runSync(
      createAiStreamHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      streamHandlers.StreamCompletion({
        model: "constructor:gpt-4o",
        prompt: "hello",
      }).pipe(Stream.runCollect),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected stream handler to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(AiProviderNotSupportedError);
    }
  });
});
