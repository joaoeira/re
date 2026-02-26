import { Schema } from "@effect/schema";

import { SecretKeySchema } from "@shared/secrets";

export class AiCompletionError extends Schema.TaggedError<AiCompletionError>(
  "@re/desktop/rpc/AiCompletionError",
)("ai_completion_error", {
  message: Schema.String,
}) {}

export class AiRateLimitError extends Schema.TaggedError<AiRateLimitError>(
  "@re/desktop/rpc/AiRateLimitError",
)("ai_rate_limit", {
  message: Schema.String,
  retryAfterMs: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
}) {}

export class AiKeyMissingError extends Schema.TaggedError<AiKeyMissingError>(
  "@re/desktop/rpc/AiKeyMissingError",
)("ai_key_missing", {
  key: SecretKeySchema,
}) {}

export class AiOfflineError extends Schema.TaggedError<AiOfflineError>(
  "@re/desktop/rpc/AiOfflineError",
)("ai_offline", {
  message: Schema.String,
}) {}

export class AiProviderNotSupportedError extends Schema.TaggedError<AiProviderNotSupportedError>(
  "@re/desktop/rpc/AiProviderNotSupportedError",
)("ai_provider_not_supported", {
  model: Schema.String,
}) {}

export const ModelIdSchema = Schema.String.pipe(Schema.pattern(/^[a-z][\w-]*:.+$/));

const AiClientErrorSchema = Schema.Union(
  AiCompletionError,
  AiRateLimitError,
  AiKeyMissingError,
  AiOfflineError,
  AiProviderNotSupportedError,
);

export const AiStreamErrorSchema = AiClientErrorSchema;
export type AiStreamError = typeof AiStreamErrorSchema.Type;

export const AiGenerateCompletionErrorSchema = AiClientErrorSchema;
export type AiGenerateCompletionError = typeof AiGenerateCompletionErrorSchema.Type;

export const AiStreamChunkSchema = Schema.Struct({
  delta: Schema.String,
});

export type AiStreamChunk = typeof AiStreamChunkSchema.Type;
