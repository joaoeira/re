import { Schema } from "@effect/schema";
import { Context, Effect, Layer } from "effect";

import bundledAiModelsJson from "../../../resources/ai-models.json";

import {
  AiModelCatalogReadFailed,
  AiModelCatalogSchemaV1,
  getAiModelCatalogValidationIssue,
  type AiModelCatalogDocument,
} from "@shared/ai-models";

export interface AiModelCatalogRepository {
  readonly getCatalog: () => Effect.Effect<AiModelCatalogDocument, AiModelCatalogReadFailed>;
}

export const AiModelCatalogRepository = Context.GenericTag<AiModelCatalogRepository>(
  "@re/desktop/main/AiModelCatalogRepository",
);

export const getBundledAiModelCatalogDocument = (): AiModelCatalogDocument => {
  const decoded = Schema.decodeUnknownSync(AiModelCatalogSchemaV1)(bundledAiModelsJson);
  const issue = getAiModelCatalogValidationIssue(decoded);

  if (issue !== null) {
    throw new Error(`Bundled AI model catalog is invalid: ${issue}`);
  }

  return decoded;
};

export const AiModelCatalogRepositoryLive = Layer.succeed(AiModelCatalogRepository, {
  getCatalog: () =>
    Effect.try({
      try: () => getBundledAiModelCatalogDocument(),
      catch: (error) =>
        new AiModelCatalogReadFailed({
          path: "bundled:ai-models.json",
          message: error instanceof Error ? error.message : String(error),
        }),
    }),
});
