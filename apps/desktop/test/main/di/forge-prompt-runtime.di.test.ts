import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createNoopReviewAnalyticsRepository } from "@main/analytics";
import { ForgePromptRuntimeService, MainAppDirectLive, NoOpAppEventPublisher } from "@main/di";
import { GetTopicsPromptSpec } from "@main/forge/prompts";
import { NoOpDeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import type { SecretStore } from "@main/secrets/secret-store";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import { DEFAULT_SETTINGS } from "@shared/settings";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  createAnthropic: vi.fn((_options: { readonly apiKey: string }) => (model: string) => ({
    provider: "anthropic",
    model,
  })),
  createOpenAI: vi.fn((_options: { readonly apiKey: string }) => (model: string) => ({
    provider: "openai",
    model,
  })),
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

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
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

const settingsRepository: SettingsRepository = {
  getSettings: () => Effect.succeed(DEFAULT_SETTINGS),
  setWorkspaceRootPath: ({ rootPath }) =>
    Effect.succeed({
      ...DEFAULT_SETTINGS,
      workspace: {
        rootPath,
      },
    }),
};

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
  it("resolves from main layer and executes prompt runtime", async () => {
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

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const runtime = yield* ForgePromptRuntimeService;
        return yield* runtime.run(
          GetTopicsPromptSpec,
          {
            chunkText: "alpha beta gamma",
            maxTopics: 2,
          },
          {
            model: "openai:gpt-4o",
          },
        );
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
  });
});
