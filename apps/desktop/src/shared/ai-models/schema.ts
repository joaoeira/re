import { Schema } from "@effect/schema";

export const AiProviderIdSchema = Schema.Literal("anthropic", "gemini", "openai", "openrouter");
export type AiProviderId = typeof AiProviderIdSchema.Type;

export const AiModelKeySchema = Schema.String.pipe(Schema.nonEmptyString());
export type AiModelKey = typeof AiModelKeySchema.Type;

export const AiModelDefinitionSchema = Schema.Struct({
  key: AiModelKeySchema,
  providerId: AiProviderIdSchema,
  providerModelId: Schema.String.pipe(Schema.nonEmptyString()),
  displayName: Schema.String.pipe(Schema.nonEmptyString()),
});
export type AiModelDefinition = typeof AiModelDefinitionSchema.Type;

export const ResolvedAiModelSchema = Schema.Struct({
  key: AiModelKeySchema,
  providerId: AiProviderIdSchema,
  providerModelId: Schema.String.pipe(Schema.nonEmptyString()),
  displayName: Schema.String.pipe(Schema.nonEmptyString()),
});
export type ResolvedAiModel = typeof ResolvedAiModelSchema.Type;

export const AiModelCatalogSchemaV1 = Schema.Struct({
  catalogVersion: Schema.Literal(1),
  applicationDefaultModelKey: AiModelKeySchema,
  models: Schema.Array(AiModelDefinitionSchema).pipe(Schema.minItems(1)),
});
export type AiModelCatalogDocument = typeof AiModelCatalogSchemaV1.Type;

export const getAiModelCatalogValidationIssue = (
  document: AiModelCatalogDocument,
): string | null => {
  const seenKeys = new Set<string>();

  for (const model of document.models) {
    if (seenKeys.has(model.key)) {
      return `Duplicate model key detected: ${model.key}`;
    }

    seenKeys.add(model.key);
  }

  const applicationDefaultModel =
    document.models.find((model) => model.key === document.applicationDefaultModelKey) ?? null;

  if (applicationDefaultModel === null) {
    return `Catalog default model key is missing: ${document.applicationDefaultModelKey}`;
  }

  return null;
};

export const toResolvedAiModel = (definition: AiModelDefinition): ResolvedAiModel => ({
  key: definition.key,
  providerId: definition.providerId,
  providerModelId: definition.providerModelId,
  displayName: definition.displayName,
});
