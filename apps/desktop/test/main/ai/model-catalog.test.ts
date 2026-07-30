import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { getBundledAiModelCatalogDocument } from "@main/ai/model-catalog-repository";
import { AiModelCatalogRepositoryLive } from "@main/ai/model-catalog-repository";
import { AiModelNotFound } from "@shared/ai-models";
import { AiModelCatalogService, AiModelCatalogServiceLive } from "@main/di";

const bundledAiModelCatalogDocument = getBundledAiModelCatalogDocument();

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

const makeCatalogService = () => {
  const catalogLayer = AiModelCatalogServiceLive.pipe(Layer.provide(AiModelCatalogRepositoryLive));

  return Effect.gen(function* () {
    return yield* AiModelCatalogService;
  }).pipe(Effect.provide(catalogLayer), Effect.runPromise);
};

describe("AI model catalog", () => {
  it("returns the bundled catalog", async () => {
    const catalogLayer = AiModelCatalogServiceLive.pipe(
      Layer.provide(AiModelCatalogRepositoryLive),
    );

    const models = await Effect.gen(function* () {
      const catalog = yield* AiModelCatalogService;
      return yield* catalog.listModels();
    }).pipe(Effect.provide(catalogLayer), Effect.runPromise);

    expect(models).toEqual(bundledAiModelCatalogDocument.models);
  });

  it("returns a model definition for an existing key", async () => {
    const catalog = await makeCatalogService();
    const model = await Effect.runPromise(catalog.getModel("gemini/gemini-3.6-flash"));

    expect(model.displayName).toBe("Gemini 3.6 Flash");
    expect(model.providerId).toBe("gemini");
  });

  it("exposes the current provider model lineups", () => {
    const providerModels = (providerId: "gemini" | "openai" | "anthropic") =>
      bundledAiModelCatalogDocument.models
        .filter((model) => model.providerId === providerId)
        .map(({ providerModelId }) => providerModelId);

    expect(providerModels("gemini")).toEqual([
      "gemini-3.6-flash",
      "gemini-3.1-pro-preview",
      "gemini-3.5-flash-lite",
    ]);
    expect(providerModels("openai")).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(providerModels("anthropic")).toEqual([
      "claude-fable-5",
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]);
  });

  it("fails with AiModelNotFound for an unknown key", async () => {
    const catalog = await makeCatalogService();
    const exit = await Effect.runPromiseExit(catalog.getModel("openai/does-not-exist"));
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(AiModelNotFound);
  });
});
