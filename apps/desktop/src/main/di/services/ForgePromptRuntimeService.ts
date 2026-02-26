import { Effect, Layer } from "effect";

import {
  ForgePromptRuntime,
  makeForgePromptRuntime,
  type ForgePromptRuntime as ForgePromptRuntimeContract,
} from "@main/forge/services/prompt-runtime";

import { AiClientService } from "./AiClientService";

export const ForgePromptRuntimeService = ForgePromptRuntime;
export type ForgePromptRuntimeService = ForgePromptRuntimeContract;

export const ForgePromptRuntimeServiceLive = Layer.effect(
  ForgePromptRuntimeService,
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;
    return makeForgePromptRuntime({ aiClient });
  }),
);
