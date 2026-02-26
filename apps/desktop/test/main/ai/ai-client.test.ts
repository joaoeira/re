import { Cause, Effect, Exit, Fiber, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { generateText as generateTextFn } from "ai";

import { makeAiClient } from "@main/ai/ai-client";
import type { SecretStore } from "@main/secrets/secret-store";
import {
  AiCompletionError,
  AiKeyMissingError,
  AiOfflineError,
  AiProviderNotSupportedError,
  AiRateLimitError,
} from "@shared/rpc/schemas/ai";
import { SecretNotFound, SecretStoreUnavailable } from "@shared/secrets";

const ANTHROPIC_MODEL = "anthropic:claude-sonnet-4-20250514";
const OPENAI_MODEL = "openai:gpt-4o";

type StreamTextInput = {
  readonly model?: unknown;
  readonly prompt: string;
  readonly system?: string;
  readonly abortSignal?: AbortSignal;
};

type StreamTextResult = {
  readonly textStream: AsyncIterable<string>;
};

type GenerateTextInput = Parameters<typeof generateTextFn>[0];

type GenerateTextResult = {
  readonly text: string;
};

const mocks = vi.hoisted(() => {
  class MockAPICallError extends Error {
    readonly statusCode: number;
    readonly responseHeaders?: Readonly<Record<string, string | undefined>>;

    constructor(options: {
      readonly message: string;
      readonly statusCode: number;
      readonly responseHeaders?: Readonly<Record<string, string | undefined>>;
    }) {
      super(options.message);
      this.name = "APICallError";
      this.statusCode = options.statusCode;
      if (options.responseHeaders !== undefined) {
        this.responseHeaders = options.responseHeaders;
      }
    }

    static isInstance(value: unknown): value is MockAPICallError {
      return value instanceof MockAPICallError;
    }
  }

  return {
    APICallError: MockAPICallError,
    generateText: vi.fn<(input: GenerateTextInput) => Promise<GenerateTextResult>>(),
    streamText: vi.fn<(input: StreamTextInput) => StreamTextResult>(),
    createAnthropic: vi.fn((_options: { readonly apiKey: string }) => (model: string) => ({
      provider: "anthropic",
      model,
    })),
    createOpenAI: vi.fn((_options: { readonly apiKey: string }) => (model: string) => ({
      provider: "openai",
      model,
    })),
  };
});

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  streamText: mocks.streamText,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@ai-sdk/provider", () => ({
  APICallError: mocks.APICallError,
}));

const makeSecretStore = (getSecret: SecretStore["getSecret"]): SecretStore => ({
  getSecret,
  setSecret: () => Effect.void,
  deleteSecret: () => Effect.void,
  hasSecret: () => Effect.succeed(false),
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

const makeServiceWithKey = () =>
  makeAiClient({
    secretStore: makeSecretStore((key) =>
      Effect.succeed(key === "openai-api-key" ? "sk-openai-test" : "sk-anthropic-test"),
    ),
  });

describe("makeAiClient", () => {
  beforeEach(() => {
    mocks.generateText.mockReset();
    mocks.streamText.mockReset();
    mocks.createAnthropic.mockClear();
    mocks.createOpenAI.mockClear();
  });

  it("routes anthropic models to anthropic provider with anthropic key", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-anthropic-test";
        }),
      ),
    });

    mocks.streamText.mockImplementation(() => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          yield "ok";
        },
      },
    }));

    const chunks = await Effect.runPromise(
      service.streamCompletion({ model: ANTHROPIC_MODEL, prompt: "hello" }).pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual(["ok"]);
    expect(requestedKeys).toEqual(["anthropic-api-key"]);
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-anthropic-test" });
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      }),
    );
  });

  it("routes openai models to openai provider with openai key", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-openai-test";
        }),
      ),
    });

    mocks.streamText.mockImplementation(() => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          yield "ok";
        },
      },
    }));

    const chunks = await Effect.runPromise(
      service.streamCompletion({ model: OPENAI_MODEL, prompt: "hello" }).pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual(["ok"]);
    expect(requestedKeys).toEqual(["openai-api-key"]);
    expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-openai-test" });
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "openai", model: "gpt-4o" },
      }),
    );
  });

  it("fails with ai_provider_not_supported before fetching secrets", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service
        .streamCompletion({ model: "mistral:mixtral-8x7b", prompt: "hello" })
        .pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("mistral:mixtral-8x7b");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("fails with ai_provider_not_supported for model ids without colon", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service.streamCompletion({ model: "openai", prompt: "hello" }).pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("openai");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("blocks prototype-pollution provider ids like constructor", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service
        .streamCompletion({ model: "constructor:gpt-4o", prompt: "hello" })
        .pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("constructor:gpt-4o");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("maps missing provider key to ai_key_missing before calling the provider", async () => {
    const service = makeAiClient({
      secretStore: makeSecretStore((key) => Effect.fail(new SecretNotFound({ key }))),
    });

    const exit = await Effect.runPromiseExit(
      service.streamCompletion({ model: OPENAI_MODEL, prompt: "hello" }).pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiKeyMissingError);
    if (failure instanceof AiKeyMissingError) {
      expect(failure.key).toBe("openai-api-key");
    }
    expect(mocks.streamText).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("generateCompletion routes provider, passes options through, and returns generated text", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-openai-test";
        }),
      ),
    });

    mocks.generateText.mockResolvedValue({ text: "generated text" });

    const text = await Effect.runPromise(
      service.generateCompletion({
        model: OPENAI_MODEL,
        prompt: "hello",
        systemPrompt: "Be concise",
        temperature: 0.2,
        maxTokens: 128,
      }),
    );

    expect(text).toBe("generated text");
    expect(requestedKeys).toEqual(["openai-api-key"]);
    expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-openai-test" });
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.generateText).toHaveBeenCalledWith({
      model: { provider: "openai", model: "gpt-4o" },
      prompt: "hello",
      system: "Be concise",
      temperature: 0.2,
      maxOutputTokens: 128,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("generateCompletion routes anthropic models and omits optional provider settings when unset", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-anthropic-test";
        }),
      ),
    });

    mocks.generateText.mockResolvedValue({ text: "anthropic text" });

    const text = await Effect.runPromise(
      service.generateCompletion({
        model: ANTHROPIC_MODEL,
        prompt: "hello",
      }),
    );

    expect(text).toBe("anthropic text");
    expect(requestedKeys).toEqual(["anthropic-api-key"]);
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-anthropic-test" });
    expect(mocks.createOpenAI).not.toHaveBeenCalled();

    const call = mocks.generateText.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      prompt: "hello",
      abortSignal: expect.any(AbortSignal),
    });
    expect(call).not.toHaveProperty("system");
    expect(call).not.toHaveProperty("temperature");
    expect(call).not.toHaveProperty("maxOutputTokens");
  });

  it("generateCompletion fails with ai_provider_not_supported before fetching secrets", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service.generateCompletion({ model: "mistral:mixtral-8x7b", prompt: "hello" }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("mistral:mixtral-8x7b");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("generateCompletion blocks prototype-pollution provider ids like constructor", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service.generateCompletion({ model: "constructor:gpt-4o", prompt: "hello" }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("constructor:gpt-4o");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("generateCompletion maps missing provider key to ai_key_missing before calling provider", async () => {
    const service = makeAiClient({
      secretStore: makeSecretStore((key) => Effect.fail(new SecretNotFound({ key }))),
    });

    const exit = await Effect.runPromiseExit(
      service.generateCompletion({ model: OPENAI_MODEL, prompt: "hello" }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiKeyMissingError);
    if (failure instanceof AiKeyMissingError) {
      expect(failure.key).toBe("openai-api-key");
    }
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("generateCompletion maps SecretStoreUnavailable to ai_completion_error", async () => {
    const service = makeAiClient({
      secretStore: makeSecretStore((_key) =>
        Effect.fail(new SecretStoreUnavailable({ message: "Secret store is unavailable." })),
      ),
    });

    const exit = await Effect.runPromiseExit(
      service.generateCompletion({ model: OPENAI_MODEL, prompt: "hello" }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiCompletionError);
    if (failure instanceof AiCompletionError) {
      expect(failure.message).toBe("Secret store is unavailable.");
    }
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("generateCompletion maps APICallError 429 to ai_rate_limit and parses retry-after", async () => {
    mocks.generateText.mockRejectedValue(
      new mocks.APICallError({
        message: "rate limited",
        statusCode: 429,
        responseHeaders: { "retry-after": "2" },
      }),
    );

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.generateCompletion({ model: OPENAI_MODEL, prompt: "hello" }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiRateLimitError);
    if (failure instanceof AiRateLimitError) {
      expect(failure.retryAfterMs).toBe(2000);
      expect(failure.message).toBe("rate limited");
    }
  });

  it("generateCompletion maps non-429 APICallError to ai_completion_error", async () => {
    mocks.generateText.mockRejectedValue(
      new mocks.APICallError({
        message: "upstream failed",
        statusCode: 500,
      }),
    );

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.generateCompletion({ model: OPENAI_MODEL, prompt: "hello" }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiCompletionError);
    if (failure instanceof AiCompletionError) {
      expect(failure.message).toBe("upstream failed");
    }
  });

  it("generateCompletion maps network TypeError to ai_offline", async () => {
    mocks.generateText.mockRejectedValue(new TypeError("fetch failed"));

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.generateCompletion({ model: ANTHROPIC_MODEL, prompt: "hello" }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiOfflineError);
    if (failure instanceof AiOfflineError) {
      expect(failure.message).toBe("Network request failed.");
    }
  });

  it("aborts generateCompletion provider request when effect fiber is interrupted", async () => {
    let capturedSignal: AbortSignal | undefined;

    mocks.generateText.mockImplementation(async (input) => {
      capturedSignal = input.abortSignal;
      await new Promise<void>((resolve) => {
        if (!input.abortSignal || input.abortSignal.aborted) {
          resolve();
          return;
        }

        input.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { text: "unreachable" };
    });

    const service = makeServiceWithKey();
    const fiber = Effect.runFork(
      service.generateCompletion({ model: ANTHROPIC_MODEL, prompt: "hello" }),
    );

    await vi.waitFor(() => {
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
    });
    expect(capturedSignal?.aborted).toBe(false);

    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("maps APICallError 429 to ai_rate_limit and parses retry-after", async () => {
    mocks.streamText.mockImplementation(() => ({
      textStream: {
        // async generator required to match textStream's AsyncIterable interface
        async *[Symbol.asyncIterator]() {
          yield* [];
          throw new mocks.APICallError({
            message: "rate limited",
            statusCode: 429,
            responseHeaders: { "retry-after": "2" },
          });
        },
      },
    }));

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.streamCompletion({ model: OPENAI_MODEL, prompt: "hello" }).pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiRateLimitError);
    if (failure instanceof AiRateLimitError) {
      expect(failure.retryAfterMs).toBe(2000);
      expect(failure.message).toBe("rate limited");
    }
  });

  it("maps network TypeError to ai_offline", async () => {
    mocks.streamText.mockImplementation(() => ({
      textStream: {
        // async generator required to match textStream's AsyncIterable interface
        async *[Symbol.asyncIterator]() {
          yield* [];
          throw new TypeError("fetch failed");
        },
      },
    }));

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.streamCompletion({ model: ANTHROPIC_MODEL, prompt: "hello" }).pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiOfflineError);
    if (failure instanceof AiOfflineError) {
      expect(failure.message).toBe("Network request failed.");
    }
  });

  it("aborts provider request when stream fiber is interrupted", async () => {
    let capturedSignal: AbortSignal | undefined;

    mocks.streamText.mockImplementation((input) => {
      capturedSignal = input.abortSignal;
      return {
        textStream: {
          // async generator required to match textStream's AsyncIterable interface
          async *[Symbol.asyncIterator]() {
            yield* [];
            while (!(input.abortSignal?.aborted ?? true)) {
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          },
        },
      };
    });

    const service = makeServiceWithKey();
    const fiber = Effect.runFork(
      service.streamCompletion({ model: ANTHROPIC_MODEL, prompt: "hello" }).pipe(Stream.runDrain),
    );

    await vi.waitFor(() => {
      expect(mocks.streamText).toHaveBeenCalledTimes(1);
    });
    expect(capturedSignal?.aborted).toBe(false);

    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("stops token pull loop when downstream ends (emit.single returns false)", async () => {
    const pulled: string[] = [];

    mocks.streamText.mockImplementation(() => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          for (const token of ["a", "b", "c"]) {
            pulled.push(token);
            yield token;
            await new Promise((resolve) => setTimeout(resolve, 2));
          }
        },
      },
    }));

    const service = makeServiceWithKey();
    const firstChunk = await Effect.runPromise(
      service
        .streamCompletion({ model: ANTHROPIC_MODEL, prompt: "hello" })
        .pipe(Stream.take(1), Stream.runCollect),
    );

    expect(Array.from(firstChunk)).toEqual(["a"]);
    expect(pulled).not.toContain("c");
  });

  it("surfaces mid-stream failures as ai_completion_error after partial output", async () => {
    const deltas: string[] = [];

    mocks.streamText.mockImplementation(() => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          yield "first";
          throw new Error("boom");
        },
      },
    }));

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.streamCompletion({ model: ANTHROPIC_MODEL, prompt: "hello" }).pipe(
        Stream.runForEach((delta) =>
          Effect.sync(() => {
            deltas.push(delta);
          }),
        ),
      ),
    );
    const failure = getFailure(exit);

    expect(deltas).toEqual(["first"]);
    expect(failure).toBeInstanceOf(AiCompletionError);
    if (failure instanceof AiCompletionError) {
      expect(failure.message).toBe("boom");
    }
  });
});
