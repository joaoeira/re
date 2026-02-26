import { Effect, Stream } from "effect";
import type { Implementations, StreamImplementations } from "electron-effect-rpc/types";

import { AiClientService } from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

type AiHandlerKeys = "GenerateCompletion";
type AiStreamHandlerKeys = "StreamCompletion";

export const createAiHandlers = () =>
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;

    const handlers: Pick<Implementations<AppContract, never>, AiHandlerKeys> = {
      GenerateCompletion: ({ model, prompt, systemPrompt, temperature, maxTokens }) =>
        aiClient
          .generateCompletion({ model, prompt, systemPrompt, temperature, maxTokens })
          .pipe(Effect.map((text) => ({ text }))),
    };

    return handlers;
  });

export const createAiStreamHandlers = () =>
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;

    const streamHandlers: Pick<StreamImplementations<AppContract, never>, AiStreamHandlerKeys> = {
      StreamCompletion: ({ model, prompt, systemPrompt }) =>
        aiClient
          .streamCompletion({ model, prompt, systemPrompt })
          .pipe(Stream.map((delta) => ({ delta }))),
    };

    return streamHandlers;
  });
