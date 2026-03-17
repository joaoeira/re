import { Context, Effect } from "effect";

import {
  AiModelNotFound,
  toResolvedAiModel,
  type AiModelCatalogDocument,
  type AiModelDefinition,
  type ResolvedAiModel,
} from "@shared/ai-models";

export interface AiModelCatalog {
  readonly getModel: (key: string) => Effect.Effect<AiModelDefinition, AiModelNotFound>;
  readonly listModels: () => Effect.Effect<ReadonlyArray<AiModelDefinition>>;
  readonly getApplicationDefaultModelKey: () => Effect.Effect<string>;
}

export const AiModelCatalog = Context.GenericTag<AiModelCatalog>("@re/desktop/main/AiModelCatalog");

/**
 * Shared helper: catalog lookup → reject not-found → project to ResolvedAiModel.
 * All call sites that resolve a model key against the catalog should use this.
 */
export const resolveModelFromCatalog = <E>(
  catalog: AiModelCatalog,
  key: string,
  mapError: (key: string) => E,
): Effect.Effect<ResolvedAiModel, E> =>
  catalog.getModel(key).pipe(
    Effect.catchTag("AiModelNotFound", () => Effect.fail(mapError(key))),
    Effect.map(toResolvedAiModel),
  );

export const makeAiModelCatalog = (document: AiModelCatalogDocument): AiModelCatalog => {
  const models = Object.freeze(
    document.models.map((model) => Object.freeze({ ...model })),
  ) as ReadonlyArray<AiModelDefinition>;
  const modelsByKey = new Map<string, AiModelDefinition>(
    models.map((model) => [model.key, model] as const),
  );
  const applicationDefaultModelKey = document.applicationDefaultModelKey;

  return {
    getModel: (key) => {
      const model = modelsByKey.get(key);

      return model === undefined
        ? Effect.fail(new AiModelNotFound({ modelKey: key }))
        : Effect.succeed(model);
    },
    listModels: () => Effect.succeed(models),
    getApplicationDefaultModelKey: () => Effect.succeed(applicationDefaultModelKey),
  };
};
