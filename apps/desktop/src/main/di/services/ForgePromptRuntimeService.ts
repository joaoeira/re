import { Effect, Layer } from "effect";

import {
  ForgePromptRuntime,
  makeForgePromptRuntime,
  type ForgePromptRuntime as ForgePromptRuntimeContract,
} from "@main/forge/services/prompt-runtime";

import { AiModelCatalogService } from "./AiModelCatalogService";
import { AiClientService } from "./AiClientService";
import { PromptModelResolverService } from "./PromptModelResolverService";

export const ForgePromptRuntimeService = ForgePromptRuntime;
export type ForgePromptRuntimeService = ForgePromptRuntimeContract;

export const ForgePromptRuntimeServiceLive = Layer.effect(
  ForgePromptRuntimeService,
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;
    const aiModelCatalog = yield* AiModelCatalogService;
    const promptModelResolver = yield* PromptModelResolverService;
    return makeForgePromptRuntime({
      aiClient,
      aiModelCatalog,
      promptModelResolver,
    });
  }),
);
