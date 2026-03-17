import { Effect, Layer } from "effect";

import {
  PromptModelResolver,
  makePromptModelResolver,
  type PromptModelResolver as PromptModelResolverContract,
} from "@main/ai/prompt-model-resolver";

import { AiModelCatalogService } from "./AiModelCatalogService";
import { SettingsRepositoryService } from "./SettingsRepositoryService";

export const PromptModelResolverService = PromptModelResolver;
export type PromptModelResolverService = PromptModelResolverContract;

export const PromptModelResolverServiceLive = Layer.effect(
  PromptModelResolverService,
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepositoryService;
    const aiModelCatalog = yield* AiModelCatalogService;
    return makePromptModelResolver({
      settingsRepository,
      aiModelCatalog,
    });
  }),
);
