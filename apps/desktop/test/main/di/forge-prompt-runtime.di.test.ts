import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createNoopReviewAnalyticsRepository } from "@main/analytics";
import { ForgePromptRuntimeService, MainAppDirectLive, NoOpAppEventPublisher } from "@main/di";
import { GetTopicsPromptSpec } from "@main/forge/prompts";
import { NoOpDeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import type { SecretStore } from "@main/secrets/secret-store";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import { DEFAULT_SETTINGS, type Settings } from "@shared/settings";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
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
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  streamText: mocks.streamText,
  RetryError: class RetryError {
    readonly lastError: unknown;

    constructor(lastError: unknown) {
      this.lastError = lastError;
    }

    static isInstance(value: unknown): value is RetryError {
      return value instanceof RetryError;
    }
  },
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
  APICallError: class APICallError extends Error {
    readonly statusCode: number;

    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }

    static isInstance(value: unknown): value is APICallError {
      return value instanceof APICallError;
    }
  },
}));

const makeSettingsRepository = (settings: Settings = DEFAULT_SETTINGS): SettingsRepository => ({
  getSettings: () => Effect.succeed(settings),
  setWorkspaceRootPath: ({ rootPath }) =>
    Effect.succeed({
      ...settings,
      workspace: {
        rootPath,
      },
    }),
});

const secretStore: SecretStore = {
  getSecret: () => Effect.succeed("sk-test"),
  setSecret: () => Effect.void,
  deleteSecret: () => Effect.void,
  hasSecret: () => Effect.succeed(true),
};

const watcher: WorkspaceWatcher = {
  start: () => undefined,
  stop: () => undefined,
};

describe("ForgePromptRuntime DI", () => {
  it("resolves from main layer through the prompt model resolver and executes prompt runtime", async () => {
    mocks.generateText.mockResolvedValue({
      text: '{"topics":["alpha","beta"]}',
      finishReason: "stop",
      response: {
        modelId: "gpt-4o",
      },
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        totalTokens: 17,
      },
    });
    const settingsRepository = makeSettingsRepository({
      ...DEFAULT_SETTINGS,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        promptModelOverrides: {
          "forge/get-topics": "openai/gpt-5.4",
        },
      },
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ForgePromptRuntimeService;
        return yield* runtime.run(GetTopicsPromptSpec, {
          chunkText: "alpha beta gamma",
        });
      }).pipe(
        Effect.provide(
          MainAppDirectLive({
            settingsRepository,
            secretStore,
            analyticsRepository: createNoopReviewAnalyticsRepository(),
            deckWriteCoordinator: NoOpDeckWriteCoordinator,
            publish: NoOpAppEventPublisher,
            watcher,
            openEditorWindow: () => undefined,
          }),
        ),
      ),
    );

    expect(result.output).toEqual({ topics: ["alpha", "beta"] });
    expect(result.metadata.promptId).toBe("forge/get-topics");
    expect(result.metadata.attemptCount).toBe(1);
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          provider: "openai",
          model: "gpt-5.4",
        },
      }),
    );
    expect(mocks.createGoogleGenerativeAI).not.toHaveBeenCalled();
  });
});
