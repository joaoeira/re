import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { makeAiModelCatalog } from "@main/ai/model-catalog";
import { makePromptModelResolver } from "@main/ai/prompt-model-resolver";
import type { SettingsRepository } from "@main/settings/repository";
import { PromptModelResolutionFailed, type AiModelCatalogDocument } from "@shared/ai-models";
import type { Settings } from "@shared/settings";

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

const BASE_CATALOG: AiModelCatalogDocument = {
  catalogVersion: 1,
  applicationDefaultModelKey: "gemini/gemini-3-flash-preview",
  models: [
    {
      key: "gemini/gemini-3-flash-preview",
      providerId: "gemini",
      providerModelId: "gemini-3-flash-preview",
      displayName: "Gemini 3 Flash Preview",
    },
    {
      key: "openai/gpt-5.4",
      providerId: "openai",
      providerModelId: "gpt-5.4",
      displayName: "OpenAI GPT-5.4",
    },
  ],
};

const makeSettings = (overrides: Partial<Settings["ai"]> = {}): Settings => ({
  settingsVersion: 2,
  workspace: {
    rootPath: null,
  },
  ai: {
    defaultModelKey: null,
    promptModelOverrides: {},
    ...overrides,
  },
});

const makeSettingsRepository = (settings: Settings): SettingsRepository => ({
  getSettings: () => Effect.succeed(settings),
  setWorkspaceRootPath: () => Effect.succeed(settings),
  setDefaultModelKey: () => Effect.succeed(settings),
  setPromptModelOverride: () => Effect.succeed(settings),
});

const resolve = (settings: Settings, catalog: AiModelCatalogDocument = BASE_CATALOG) =>
  Effect.runPromise(
    makePromptModelResolver({
      settingsRepository: makeSettingsRepository(settings),
      aiModelCatalog: makeAiModelCatalog(catalog),
    }).resolve("forge/test-prompt"),
  );

describe("PromptModelResolver", () => {
  it("prefers a prompt override over the user default", async () => {
    const result = await resolve(
      makeSettings({
        defaultModelKey: "gemini/gemini-3-flash-preview",
        promptModelOverrides: {
          "forge/test-prompt": "openai/gpt-5.4",
        },
      }),
    );

    expect(result.model.key).toBe("openai/gpt-5.4");
    expect(result.source).toBe("prompt-override");
  });

  it("prefers the user default over the catalog default", async () => {
    const result = await resolve(
      makeSettings({
        defaultModelKey: "openai/gpt-5.4",
      }),
    );

    expect(result.model.key).toBe("openai/gpt-5.4");
    expect(result.source).toBe("user-default");
  });

  it("falls through to the catalog default when the user default is null", async () => {
    const result = await resolve(makeSettings());

    expect(result.model.key).toBe("gemini/gemini-3-flash-preview");
    expect(result.source).toBe("catalog-default");
  });

  it("falls through to the user default when the prompt override is missing", async () => {
    const result = await resolve(
      makeSettings({
        defaultModelKey: "openai/gpt-5.4",
        promptModelOverrides: {
          "forge/another-prompt": "gemini/gemini-3-flash-preview",
        },
      }),
    );

    expect(result.model.key).toBe("openai/gpt-5.4");
    expect(result.source).toBe("user-default");
  });

  it("skips stale prompt overrides and falls through to the user default", async () => {
    const result = await resolve(
      makeSettings({
        defaultModelKey: "openai/gpt-5.4",
        promptModelOverrides: {
          "forge/test-prompt": "openai/does-not-exist",
        },
      }),
    );

    expect(result.model.key).toBe("openai/gpt-5.4");
    expect(result.source).toBe("user-default");
  });

  it("fails when every configured candidate is invalid", async () => {
    const exit = await Effect.runPromiseExit(
      makePromptModelResolver({
        settingsRepository: makeSettingsRepository(
          makeSettings({
            defaultModelKey: "openai/does-not-exist-2",
            promptModelOverrides: {
              "forge/test-prompt": "openai/does-not-exist",
            },
          }),
        ),
        aiModelCatalog: makeAiModelCatalog({
          ...BASE_CATALOG,
          applicationDefaultModelKey: "openai/does-not-exist-3",
        }),
      }).resolve("forge/test-prompt"),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptModelResolutionFailed);
    if (failure instanceof PromptModelResolutionFailed) {
      expect(failure.message).toContain("openai/does-not-exist");
      expect(failure.message).toContain("openai/does-not-exist-3");
    }
  });
});
