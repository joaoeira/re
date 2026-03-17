import { Cause, Effect, Exit, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";

import type { AiClient } from "@main/ai/ai-client";
import { makeAiModelCatalog } from "@main/ai/model-catalog";
import { getBundledAiModelCatalogDocument } from "@main/ai/model-catalog-repository";
import { AiClientServiceLive, AiModelCatalogService } from "@main/di";
import { createAiHandlers, createAiStreamHandlers } from "@main/rpc/handlers/ai";
import type { ResolvedAiModel } from "@shared/ai-models";
import { AiProviderNotSupportedError, AiRateLimitError } from "@shared/rpc/schemas/ai";

const OPENAI_MODEL: ResolvedAiModel = {
  key: "openai/gpt-5.4",
  providerId: "openai",
  providerModelId: "gpt-5.4",
  displayName: "OpenAI GPT-5.4",
};

const INVALID_MODEL = {
  key: "constructor/gpt-4o",
  providerId: "constructor",
  providerModelId: "gpt-4o",
  displayName: "Constructor GPT-4o",
} as unknown as ResolvedAiModel;

const aiHandlerServices = (mockAiClient: AiClient) =>
  Layer.mergeAll(
    AiClientServiceLive(mockAiClient),
    Layer.succeed(AiModelCatalogService, makeAiModelCatalog(getBundledAiModelCatalogDocument())),
  );

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
      createAiHandlers().pipe(Effect.provide(aiHandlerServices(mockAiClient))),
    );

    const result = await Effect.runPromise(
      handlers.AiGenerateText({
        model: OPENAI_MODEL,
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
      createAiHandlers().pipe(Effect.provide(aiHandlerServices(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      handlers.AiGenerateText({
        model: OPENAI_MODEL,
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

  it("canonicalizes the requested model through the catalog before invoking the AI client", async () => {
    let receivedModel: ResolvedAiModel | null = null;
    const mockAiClient: AiClient = {
      generateText: ({ model }) => {
        receivedModel = model;
        return Effect.succeed({
          text: "ok",
          finishReason: "stop",
          model: model.providerModelId,
          usage: {},
        });
      },
      streamText: () => Stream.empty,
    };

    const handlers = Effect.runSync(
      createAiHandlers().pipe(Effect.provide(aiHandlerServices(mockAiClient))),
    );

    await Effect.runPromise(
      handlers.AiGenerateText({
        model: {
          key: "openai/gpt-5.4",
          providerId: "anthropic",
          providerModelId: "claude-sonnet-4-20250514",
          displayName: "Forged tuple",
        } as unknown as ResolvedAiModel,
        messages: [{ role: "user", content: "hello world" }],
      }),
    );

    expect(receivedModel).toEqual({
      key: "openai/gpt-5.4",
      providerId: "openai",
      providerModelId: "gpt-5.4",
      displayName: "OpenAI GPT-5.4",
    });
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
      createAiStreamHandlers().pipe(Effect.provide(aiHandlerServices(mockAiClient))),
    );

    const chunks = await Effect.runPromise(
      streamHandlers
        .AiStreamText({
          model: OPENAI_MODEL,
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
      createAiStreamHandlers().pipe(Effect.provide(aiHandlerServices(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      streamHandlers
        .AiStreamText({
          model: OPENAI_MODEL,
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

  it("rejects models that are not present in the catalog before streaming", async () => {
    const mockAiClient: AiClient = {
      generateText: () =>
        Effect.succeed({
          text: "unused",
          finishReason: "stop",
          model: "unused",
          usage: {},
        }),
      streamText: () => Stream.die("streamText should not be called for invalid catalog keys"),
    };

    const streamHandlers = Effect.runSync(
      createAiStreamHandlers().pipe(Effect.provide(aiHandlerServices(mockAiClient))),
    );

    const exit = await Effect.runPromiseExit(
      streamHandlers
        .AiStreamText({
          model: INVALID_MODEL,
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
