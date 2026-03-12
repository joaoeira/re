import { Cause, Effect, Exit, Fiber, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const GEMINI_MODEL = "gemini:gemini-2.5-flash";
const OPENAI_MODEL = "openai:gpt-4o";
const OPENROUTER_MODEL = "openrouter:openai/gpt-4o";

const DEFAULT_MESSAGES = [{ role: "user", content: "hello" }] as const;

type MockGenerateTextInput = {
  readonly model?: unknown;
  readonly messages: ReadonlyArray<unknown>;
  readonly system?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly maxRetries?: number;
  readonly abortSignal?: AbortSignal;
};

type MockStreamTextInput = MockGenerateTextInput;

type MockGenerateTextResult = {
  readonly text: string;
  readonly finishReason: string;
  readonly response: {
    readonly modelId: string;
  };
  readonly usage: {
    readonly inputTokens?: number;
    readonly inputTokenDetails?: {
      readonly noCacheTokens?: number;
      readonly cacheReadTokens?: number;
      readonly cacheWriteTokens?: number;
    };
    readonly outputTokens?: number;
    readonly outputTokenDetails?: {
      readonly textTokens?: number;
      readonly reasoningTokens?: number;
    };
    readonly totalTokens?: number;
  };
};

type MockStreamTextResult = {
  readonly textStream: AsyncIterable<string>;
};

const makeGenerateResult = (
  overrides: Partial<MockGenerateTextResult> = {},
): MockGenerateTextResult => ({
  text: "generated text",
  finishReason: "stop",
  response: {
    modelId: "gpt-4o",
  },
  usage: {
    inputTokens: 10,
    inputTokenDetails: {
      noCacheTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 5,
    outputTokenDetails: {
      textTokens: 5,
      reasoningTokens: 0,
    },
    totalTokens: 15,
  },
  ...overrides,
});

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

  class MockRetryError extends Error {
    readonly lastError: unknown;

    constructor(lastError: unknown) {
      super("Retry failed");
      this.name = "RetryError";
      this.lastError = lastError;
    }

    static isInstance(value: unknown): value is MockRetryError {
      return value instanceof MockRetryError;
    }
  }

  return {
    APICallError: MockAPICallError,
    RetryError: MockRetryError,
    generateText: vi.fn<(input: MockGenerateTextInput) => Promise<MockGenerateTextResult>>(),
    streamText: vi.fn<(input: MockStreamTextInput) => MockStreamTextResult>(),
    createAnthropic: vi.fn((_options: { readonly apiKey: string }) => (model: string) => ({
      provider: "anthropic",
      model,
    })),
    createGoogleGenerativeAI: vi.fn((_options: { readonly apiKey: string }) => (model: string) => ({
      provider: "gemini",
      model,
    })),
    createOpenAI: vi.fn((_options: { readonly apiKey: string }) => (model: string) => ({
      provider: "openai",
      model,
    })),
    createOpenRouter: vi.fn(
      (_options: { readonly apiKey: string; readonly compatibility: "strict" }) =>
        (model: string) => ({
          provider: "openrouter",
          model,
        }),
    ),
  };
});

vi.mock("ai", () => ({
  RetryError: mocks.RetryError,
  generateText: mocks.generateText,
  streamText: mocks.streamText,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mocks.createGoogleGenerativeAI,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: mocks.createOpenRouter,
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

const makeServiceWithKey = () =>
  makeAiClient({
    secretStore: makeSecretStore((key) => {
      switch (key) {
        case "openai-api-key":
          return Effect.succeed("sk-openai-test");
        case "anthropic-api-key":
          return Effect.succeed("sk-anthropic-test");
        case "gemini-api-key":
          return Effect.succeed("sk-gemini-test");
        case "openrouter-api-key":
          return Effect.succeed("sk-openrouter-test");
      }
    }),
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

describe("makeAiClient", () => {
  beforeEach(() => {
    mocks.generateText.mockReset();
    mocks.streamText.mockReset();
    mocks.createAnthropic.mockClear();
    mocks.createGoogleGenerativeAI.mockClear();
    mocks.createOpenAI.mockClear();
    mocks.createOpenRouter.mockClear();
  });

  it("routes anthropic stream requests to anthropic provider with anthropic key", async () => {
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
      service
        .streamText({ model: ANTHROPIC_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual(["ok"]);
    expect(requestedKeys).toEqual(["anthropic-api-key"]);
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-anthropic-test" });
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        messages: [{ role: "user", content: "hello" }],
        maxRetries: 0,
      }),
    );
  });

  it("routes openai stream requests to openai provider with openai key", async () => {
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
      service
        .streamText({ model: OPENAI_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual(["ok"]);
    expect(requestedKeys).toEqual(["openai-api-key"]);
    expect(mocks.createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-openai-test" });
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled();
    expect(mocks.createOpenRouter).not.toHaveBeenCalled();
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "openai", model: "gpt-4o" },
        maxRetries: 0,
      }),
    );
  });

  it("routes gemini stream requests to gemini provider with gemini key", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-gemini-test";
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
      service
        .streamText({ model: GEMINI_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual(["ok"]);
    expect(requestedKeys).toEqual(["gemini-api-key"]);
    expect(mocks.createGoogleGenerativeAI).toHaveBeenCalledWith({ apiKey: "sk-gemini-test" });
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.createOpenRouter).not.toHaveBeenCalled();
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "gemini", model: "gemini-2.5-flash" },
        maxRetries: 0,
      }),
    );
  });

  it("routes openrouter stream requests to openrouter provider with openrouter key", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-openrouter-test";
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
      service
        .streamText({ model: OPENROUTER_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual(["ok"]);
    expect(requestedKeys).toEqual(["openrouter-api-key"]);
    expect(mocks.createOpenRouter).toHaveBeenCalledWith({
      apiKey: "sk-openrouter-test",
      compatibility: "strict",
    });
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "openrouter", model: "openai/gpt-4o" },
        maxRetries: 0,
      }),
    );
  });

  it("generateText routes provider, forwards options, and returns structured output", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-openai-test";
        }),
      ),
    });

    mocks.generateText.mockResolvedValue(
      makeGenerateResult({
        text: "generated text",
        finishReason: "stop",
        response: { modelId: "gpt-4o" },
        usage: {
          inputTokens: 12,
          inputTokenDetails: {
            noCacheTokens: 10,
            cacheReadTokens: 2,
            cacheWriteTokens: 0,
          },
          outputTokens: 8,
          outputTokenDetails: {
            textTokens: 7,
            reasoningTokens: 1,
          },
          totalTokens: 20,
        },
      }),
    );

    const result = await Effect.runPromise(
      service.generateText({
        model: OPENAI_MODEL,
        messages: DEFAULT_MESSAGES,
        systemPrompt: "Be concise",
        temperature: 0.2,
        maxTokens: 128,
        maxRetries: 1,
      }),
    );

    expect(result).toEqual({
      text: "generated text",
      finishReason: "stop",
      model: "gpt-4o",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        reasoningTokens: 1,
        cachedInputTokens: 2,
      },
    });
    expect(requestedKeys).toEqual(["openai-api-key"]);
    expect(mocks.generateText).toHaveBeenCalledWith({
      model: { provider: "openai", model: "gpt-4o" },
      messages: [{ role: "user", content: "hello" }],
      system: "Be concise",
      temperature: 0.2,
      maxOutputTokens: 128,
      maxRetries: 1,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("generateText routes openrouter requests to openrouter provider with openrouter key", async () => {
    const requestedKeys: string[] = [];
    const service = makeAiClient({
      secretStore: makeSecretStore((key) =>
        Effect.sync(() => {
          requestedKeys.push(key);
          return "sk-openrouter-test";
        }),
      ),
    });

    mocks.generateText.mockResolvedValue(
      makeGenerateResult({
        text: "openrouter text",
        response: { modelId: "openai/gpt-4o" },
      }),
    );

    const result = await Effect.runPromise(
      service.generateText({
        model: OPENROUTER_MODEL,
        messages: DEFAULT_MESSAGES,
      }),
    );

    expect(result.text).toBe("openrouter text");
    expect(requestedKeys).toEqual(["openrouter-api-key"]);
    expect(mocks.createOpenRouter).toHaveBeenCalledWith({
      apiKey: "sk-openrouter-test",
      compatibility: "strict",
    });
    expect(mocks.createAnthropic).not.toHaveBeenCalled();
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { provider: "openrouter", model: "openai/gpt-4o" },
        messages: [{ role: "user", content: "hello" }],
        maxRetries: 0,
        abortSignal: expect.any(AbortSignal),
      }),
    );
  });

  it("generateText defaults maxRetries to 0 and omits optional provider settings when unset", async () => {
    const service = makeAiClient({
      secretStore: makeSecretStore((_key) => Effect.succeed("sk-anthropic-test")),
    });

    mocks.generateText.mockResolvedValue(
      makeGenerateResult({
        text: "anthropic text",
        response: { modelId: "claude-sonnet-4-20250514" },
      }),
    );

    const result = await Effect.runPromise(
      service.generateText({
        model: ANTHROPIC_MODEL,
        messages: DEFAULT_MESSAGES,
      }),
    );

    expect(result.text).toBe("anthropic text");
    expect(mocks.createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-anthropic-test" });

    const call = mocks.generateText.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      model: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      messages: [{ role: "user", content: "hello" }],
      maxRetries: 0,
      abortSignal: expect.any(AbortSignal),
    });
    expect(call).not.toHaveProperty("system");
    expect(call).not.toHaveProperty("temperature");
    expect(call).not.toHaveProperty("maxOutputTokens");
  });

  it("forwards text-part arrays in messages", async () => {
    const service = makeServiceWithKey();
    mocks.generateText.mockResolvedValue(makeGenerateResult());

    await Effect.runPromise(
      service.generateText({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "first" },
              { type: "text", text: "second" },
            ],
          },
        ],
      }),
    );

    const call = mocks.generateText.mock.calls[0]?.[0];
    expect(call?.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      },
    ]);
  });

  it("fails with ai_provider_not_supported before fetching secrets", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service.generateText({ model: "mistral:mixtral-8x7b", messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("mistral:mixtral-8x7b");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("rejects google model prefix now that only gemini is supported", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service.generateText({ model: "google:gemini-2.5-flash", messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("google:gemini-2.5-flash");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("fails with ai_provider_not_supported for model ids without colon", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service.streamText({ model: "openai", messages: DEFAULT_MESSAGES }).pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("openai");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("blocks prototype-pollution provider ids like constructor", async () => {
    const getSecret = vi.fn<SecretStore["getSecret"]>((_key) => Effect.succeed("unused"));
    const service = makeAiClient({
      secretStore: makeSecretStore(getSecret),
    });

    const exit = await Effect.runPromiseExit(
      service.generateText({ model: "constructor:gpt-4o", messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiProviderNotSupportedError);
    if (failure instanceof AiProviderNotSupportedError) {
      expect(failure.model).toBe("constructor:gpt-4o");
    }
    expect(getSecret).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("maps missing provider key to ai_key_missing before calling provider", async () => {
    const service = makeAiClient({
      secretStore: makeSecretStore((key) => Effect.fail(new SecretNotFound({ key }))),
    });

    const exit = await Effect.runPromiseExit(
      service.generateText({ model: OPENAI_MODEL, messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiKeyMissingError);
    if (failure instanceof AiKeyMissingError) {
      expect(failure.key).toBe("openai-api-key");
    }
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("maps SecretStoreUnavailable to ai_completion_error", async () => {
    const service = makeAiClient({
      secretStore: makeSecretStore((_key) =>
        Effect.fail(new SecretStoreUnavailable({ message: "Secret store is unavailable." })),
      ),
    });

    const exit = await Effect.runPromiseExit(
      service.generateText({ model: OPENAI_MODEL, messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiCompletionError);
    if (failure instanceof AiCompletionError) {
      expect(failure.message).toBe("Secret store is unavailable.");
    }
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("maps APICallError 429 to ai_rate_limit and parses retry-after", async () => {
    mocks.generateText.mockRejectedValue(
      new mocks.APICallError({
        message: "rate limited",
        statusCode: 429,
        responseHeaders: { "retry-after": "2" },
      }),
    );

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.generateText({ model: OPENAI_MODEL, messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiRateLimitError);
    if (failure instanceof AiRateLimitError) {
      expect(failure.retryAfterMs).toBe(2000);
      expect(failure.message).toBe("rate limited");
    }
  });

  it("maps RetryError(lastError=429) to ai_rate_limit", async () => {
    mocks.generateText.mockRejectedValue(
      new mocks.RetryError(
        new mocks.APICallError({
          message: "still rate limited",
          statusCode: 429,
          responseHeaders: { "Retry-After": "3" },
        }),
      ),
    );

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.generateText({ model: OPENAI_MODEL, messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiRateLimitError);
    if (failure instanceof AiRateLimitError) {
      expect(failure.retryAfterMs).toBe(3000);
      expect(failure.message).toBe("still rate limited");
    }
  });

  it("maps non-429 APICallError to ai_completion_error", async () => {
    mocks.generateText.mockRejectedValue(
      new mocks.APICallError({
        message: "upstream failed",
        statusCode: 500,
      }),
    );

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.generateText({ model: OPENAI_MODEL, messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiCompletionError);
    if (failure instanceof AiCompletionError) {
      expect(failure.message).toBe("upstream failed");
    }
  });

  it("maps network TypeError to ai_offline", async () => {
    mocks.generateText.mockRejectedValue(new TypeError("fetch failed"));

    const service = makeServiceWithKey();
    const exit = await Effect.runPromiseExit(
      service.generateText({ model: ANTHROPIC_MODEL, messages: DEFAULT_MESSAGES }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiOfflineError);
    if (failure instanceof AiOfflineError) {
      expect(failure.message).toBe("Network request failed.");
    }
  });

  it("fails fast on empty messages before provider invocation", async () => {
    const service = makeServiceWithKey();

    const exit = await Effect.runPromiseExit(
      service.generateText({
        model: OPENAI_MODEL,
        messages: [],
      }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiCompletionError);
    if (failure instanceof AiCompletionError) {
      expect(failure.message).toContain("messages must contain at least one entry");
    }
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("aborts generateText provider request when effect fiber is interrupted", async () => {
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

      return makeGenerateResult();
    });

    const service = makeServiceWithKey();
    const fiber = Effect.runFork(
      service.generateText({
        model: ANTHROPIC_MODEL,
        messages: DEFAULT_MESSAGES,
      }),
    );

    await vi.waitFor(() => {
      expect(mocks.generateText).toHaveBeenCalledTimes(1);
    });
    expect(capturedSignal?.aborted).toBe(false);

    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("streamText emits deltas in order and forwards explicit generation options", async () => {
    mocks.streamText.mockImplementation(() => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          yield "hello";
          yield "world";
        },
      },
    }));

    const service = makeServiceWithKey();
    const chunks = await Effect.runPromise(
      service
        .streamText({
          model: OPENAI_MODEL,
          messages: DEFAULT_MESSAGES,
          systemPrompt: "stream",
          temperature: 0.1,
          maxTokens: 64,
          maxRetries: 4,
        })
        .pipe(Stream.runCollect),
    );

    expect(Array.from(chunks)).toEqual(["hello", "world"]);
    expect(mocks.streamText).toHaveBeenCalledWith({
      model: { provider: "openai", model: "gpt-4o" },
      messages: [{ role: "user", content: "hello" }],
      system: "stream",
      temperature: 0.1,
      maxOutputTokens: 64,
      maxRetries: 4,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("streamText defaults maxRetries to 0", async () => {
    mocks.streamText.mockImplementation(() => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          yield "token";
        },
      },
    }));

    const service = makeServiceWithKey();
    await Effect.runPromise(
      service
        .streamText({ model: ANTHROPIC_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runCollect),
    );

    const call = mocks.streamText.mock.calls[0]?.[0];
    expect(call?.maxRetries).toBe(0);
  });

  it("streamText preserves typed stream errors", async () => {
    const service = makeServiceWithKey();
    mocks.streamText.mockImplementation(() => ({
      textStream: {
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

    const exit = await Effect.runPromiseExit(
      service
        .streamText({ model: OPENAI_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runCollect),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiRateLimitError);
    if (failure instanceof AiRateLimitError) {
      expect(failure.retryAfterMs).toBe(2000);
      expect(failure.message).toBe("rate limited");
    }
  });

  it("streamText maps network TypeError to ai_offline", async () => {
    const service = makeServiceWithKey();
    mocks.streamText.mockImplementation(() => ({
      textStream: {
        async *[Symbol.asyncIterator]() {
          yield* [];
          throw new TypeError("fetch failed");
        },
      },
    }));

    const exit = await Effect.runPromiseExit(
      service
        .streamText({ model: ANTHROPIC_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runCollect),
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
      service
        .streamText({ model: ANTHROPIC_MODEL, messages: DEFAULT_MESSAGES })
        .pipe(Stream.runDrain),
    );

    await vi.waitFor(() => {
      expect(mocks.streamText).toHaveBeenCalledTimes(1);
    });
    expect(capturedSignal?.aborted).toBe(false);

    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(capturedSignal?.aborted).toBe(true);
  });
});
