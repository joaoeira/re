import { Effect, Stream } from "effect";
import type { Implementations, StreamImplementations } from "electron-effect-rpc/types";

import { AiModelCatalogService, AiClientService } from "@main/di";
import { resolveModelFromCatalog } from "@main/ai/model-catalog";
import { AiProviderNotSupportedError } from "@shared/rpc/schemas/ai";
import type { ResolvedAiModel } from "@shared/ai-models";
import type { AppContract } from "@shared/rpc/contracts";

type AiHandlerKeys = "AiGenerateText";
type AiStreamHandlerKeys = "AiStreamText";

const toProviderNotSupported = (key: string) =>
  new AiProviderNotSupportedError({ model: key });

export const createAiHandlers = () =>
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;
    const aiModelCatalog = yield* AiModelCatalogService;

    const resolveCatalogModel = (requestedModel: ResolvedAiModel) =>
      resolveModelFromCatalog(aiModelCatalog, requestedModel.key, toProviderNotSupported);

    const handlers: Pick<Implementations<AppContract, never>, AiHandlerKeys> = {
      AiGenerateText: ({ model, messages, systemPrompt, temperature, maxTokens, maxRetries }) =>
        resolveCatalogModel(model).pipe(
          Effect.flatMap((resolvedModel) =>
            aiClient.generateText({
              model: resolvedModel,
              messages,
              systemPrompt,
              temperature,
              maxTokens,
              maxRetries,
            }),
          ),
        ),
    };

    return handlers;
  });

export const createAiStreamHandlers = () =>
  Effect.gen(function* () {
    const aiClient = yield* AiClientService;
    const aiModelCatalog = yield* AiModelCatalogService;

    const resolveCatalogModel = (requestedModel: ResolvedAiModel) =>
      resolveModelFromCatalog(aiModelCatalog, requestedModel.key, toProviderNotSupported);

    const streamHandlers: Pick<StreamImplementations<AppContract, never>, AiStreamHandlerKeys> = {
      AiStreamText: ({ model, messages, systemPrompt, temperature, maxTokens, maxRetries }) =>
        Stream.unwrap(
          resolveCatalogModel(model).pipe(
            Effect.map((resolvedModel) =>
              aiClient
                .streamText({
                  model: resolvedModel,
                  messages,
                  systemPrompt,
                  temperature,
                  maxTokens,
                  maxRetries,
                })
                .pipe(Stream.map((delta) => ({ delta }))),
            ),
          ),
        ),
    };

    return streamHandlers;
  });
