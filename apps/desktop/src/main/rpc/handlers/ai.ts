import { Effect, Stream } from "effect";
import type { Implementations, StreamImplementations } from "electron-effect-rpc/types";

import { AiClientService } from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

type AiHandlerKeys = "AiGenerateText";
type AiStreamHandlerKeys = "AiStreamText";

export const createAiHandlers = () =>
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;

    const handlers: Pick<Implementations<AppContract, never>, AiHandlerKeys> = {
      AiGenerateText: ({ model, messages, systemPrompt, temperature, maxTokens, maxRetries }) =>
        aiClient.generateText({
          model,
          messages,
          systemPrompt,
          temperature,
          maxTokens,
          maxRetries,
        }),
    };

    return handlers;
  });

export const createAiStreamHandlers = () =>
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;

    const streamHandlers: Pick<StreamImplementations<AppContract, never>, AiStreamHandlerKeys> = {
      AiStreamText: ({ model, messages, systemPrompt, temperature, maxTokens, maxRetries }) =>
        aiClient
          .streamText({
            model,
            messages,
            systemPrompt,
            temperature,
            maxTokens,
            maxRetries,
          })
          .pipe(Stream.map((delta) => ({ delta }))),
    };

    return streamHandlers;
  });
