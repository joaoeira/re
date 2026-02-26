import { Cause, Effect, Exit, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { AiClient } from "@main/ai/ai-client";
import { AiClientServiceLive } from "@main/di";
import { createAiHandlers, createAiStreamHandlers } from "@main/rpc/handlers/ai";
import { AiProviderNotSupportedError, AiRateLimitError } from "@shared/rpc/schemas/ai";

describe("AI handlers", () => {
  it("maps generateText result into structured response payload", async () => {
    const mockAiClient: AiClient = {
      generateText: () =>
        Effect.succeed({
          text: "hello world",
          finishReason: "stop",
          model: "gpt-4o",
          usage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
          },
        }),
      streamText: () => Stream.empty,
    };

    const handlers = Effect.runSync(
      createAiHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const result = await Effect.runPromise(
      handlers.AiGenerateText({
        model: "anthropic:claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "hello world" }],
      }),
    );

    expect(result).toEqual({
      text: "hello world",
      finishReason: "stop",
      model: "gpt-4o",
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
    });
  });

  it("preserves typed AiGenerateText errors", async () => {
    const mockAiClient: AiClient = {
      generateText: () =>
        Effect.fail(new AiRateLimitError({ message: "rate limited", retryAfterMs: 1000 })),
      streamText: () => Stream.empty,
    };

    const handlers = Effect.runSync(
      createAiHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      handlers.AiGenerateText({
        model: "anthropic:claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "hello" }],
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected AiGenerateText handler to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(AiRateLimitError);
    }
  });
});

describe("AI stream handlers", () => {
  it("maps string deltas from AiClient into chunk objects", async () => {
    const mockAiClient: AiClient = {
      generateText: () =>
        Effect.succeed({
          text: "unused",
          finishReason: "stop",
          model: "unused",
          usage: {},
        }),
      streamText: ({ messages }) => {
        const firstMessage = messages[0];
        const content =
          firstMessage && typeof firstMessage.content === "string" ? firstMessage.content : "";
        return Stream.fromIterable(content.split(" "));
      },
    };

    const streamHandlers = Effect.runSync(
      createAiStreamHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const chunks = await Effect.runPromise(
      streamHandlers
        .AiStreamText({
          model: "anthropic:claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "hello world" }],
        })
        .pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual([{ delta: "hello" }, { delta: "world" }]);
  });

  it("preserves typed stream errors", async () => {
    const mockAiClient: AiClient = {
      generateText: () =>
        Effect.succeed({
          text: "unused",
          finishReason: "stop",
          model: "unused",
          usage: {},
        }),
      streamText: () =>
        Stream.fail(new AiRateLimitError({ message: "rate limited", retryAfterMs: 1000 })),
    };

    const streamHandlers = Effect.runSync(
      createAiStreamHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      streamHandlers
        .AiStreamText({
          model: "anthropic:claude-sonnet-4-20250514",
          messages: [{ role: "user", content: "hello" }],
        })
        .pipe(Stream.runCollect),
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
      generateText: () =>
        Effect.succeed({
          text: "unused",
          finishReason: "stop",
          model: "unused",
          usage: {},
        }),
      streamText: () =>
        Stream.fail(new AiProviderNotSupportedError({ model: "constructor:gpt-4o" })),
    };

    const streamHandlers = Effect.runSync(
      createAiStreamHandlers().pipe(Effect.provide(AiClientServiceLive(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      streamHandlers
        .AiStreamText({
          model: "constructor:gpt-4o",
          messages: [{ role: "user", content: "hello" }],
        })
        .pipe(Stream.runCollect),
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
