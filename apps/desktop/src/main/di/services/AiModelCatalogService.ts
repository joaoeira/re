import { Effect, Layer } from "effect";

import {
  AiModelCatalog,
  makeAiModelCatalog,
  type AiModelCatalog as AiModelCatalogContract,
} from "@main/ai/model-catalog";
import { AiModelCatalogRepository } from "@main/ai/model-catalog-repository";

export const AiModelCatalogService = AiModelCatalog;
export type AiModelCatalogService = AiModelCatalogContract;

export const AiModelCatalogServiceLive = Layer.effect(
  AiModelCatalogService,
  Effect.gen(function* () {
    const repository = yield* AiModelCatalogRepository;
    const document = yield* repository.getCatalog();
    return makeAiModelCatalog(document);
  }),
);
