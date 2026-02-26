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

export const AiTextPartSchema = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});
export type AiTextPart = typeof AiTextPartSchema.Type;

const AiMessageContentSchema = Schema.Union(Schema.String, Schema.Array(AiTextPartSchema));

export const AiUserMessageSchema = Schema.Struct({
  role: Schema.Literal("user"),
  content: AiMessageContentSchema,
});
export type AiUserMessage = typeof AiUserMessageSchema.Type;

export const AiAssistantMessageSchema = Schema.Struct({
  role: Schema.Literal("assistant"),
  content: AiMessageContentSchema,
});
export type AiAssistantMessage = typeof AiAssistantMessageSchema.Type;

export const AiMessageSchema = Schema.Union(AiUserMessageSchema, AiAssistantMessageSchema);
export type AiMessage = typeof AiMessageSchema.Type;

export const AiMessagesSchema = Schema.Array(AiMessageSchema).pipe(Schema.minItems(1));
export type AiMessages = typeof AiMessagesSchema.Type;

const AiClientErrorSchema = Schema.Union(
  AiCompletionError,
  AiRateLimitError,
  AiKeyMissingError,
  AiOfflineError,
  AiProviderNotSupportedError,
);

export const AiStreamErrorSchema = AiClientErrorSchema;
export type AiStreamError = typeof AiStreamErrorSchema.Type;

export const AiGenerateTextErrorSchema = AiClientErrorSchema;
export type AiGenerateTextError = typeof AiGenerateTextErrorSchema.Type;

export const AiTokenUsageSchema = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  outputTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  totalTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  reasoningTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  cachedInputTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
});
export type AiTokenUsage = typeof AiTokenUsageSchema.Type;

export const AiGenerateTextInputSchema = Schema.Struct({
  model: ModelIdSchema,
  messages: AiMessagesSchema,
  systemPrompt: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
  maxTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  maxRetries: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
});
export type AiGenerateTextInput = typeof AiGenerateTextInputSchema.Type;

export const AiGenerateTextResultSchema = Schema.Struct({
  text: Schema.String,
  finishReason: Schema.String,
  model: Schema.String,
  usage: AiTokenUsageSchema,
});
export type AiGenerateTextResult = typeof AiGenerateTextResultSchema.Type;

export const AiStreamTextInputSchema = AiGenerateTextInputSchema;
export type AiStreamTextInput = typeof AiStreamTextInputSchema.Type;

export const AiStreamChunkSchema = Schema.Struct({
  delta: Schema.String,
});

export type AiStreamChunk = typeof AiStreamChunkSchema.Type;
