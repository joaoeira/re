import { Schema } from "@effect/schema";

export class AiModelCatalogReadFailed extends Schema.TaggedError<AiModelCatalogReadFailed>(
  "@re/desktop/ai/AiModelCatalogReadFailed",
)("AiModelCatalogReadFailed", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class AiModelNotFound extends Schema.TaggedError<AiModelNotFound>(
  "@re/desktop/ai/AiModelNotFound",
)("AiModelNotFound", {
  modelKey: Schema.String,
}) {}

export class PromptModelResolutionFailed extends Schema.TaggedError<PromptModelResolutionFailed>(
  "@re/desktop/ai/PromptModelResolutionFailed",
)("PromptModelResolutionFailed", {
  promptId: Schema.String,
  message: Schema.String,
}) {}
