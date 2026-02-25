import { Schema } from "@effect/schema";

const PositiveIntSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
const NullableStringSchema = Schema.Union(Schema.String, Schema.Null);

export const ForgeSourceKindSchema = Schema.Literal("pdf", "web");
export type ForgeSourceKind = typeof ForgeSourceKindSchema.Type;

export const ForgeSessionStatusSchema = Schema.Literal(
  "created",
  "extracting",
  "extracted",
  "topics_extracting",
  "topics_extracted",
  "generating",
  "ready",
  "error",
);
export type ForgeSessionStatus = typeof ForgeSessionStatusSchema.Type;

export const ForgeSessionSchema = Schema.Struct({
  id: PositiveIntSchema,
  sourceKind: ForgeSourceKindSchema,
  sourceFilePath: Schema.String,
  deckPath: NullableStringSchema,
  sourceFingerprint: Schema.String,
  status: ForgeSessionStatusSchema,
  errorMessage: NullableStringSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ForgeSession = typeof ForgeSessionSchema.Type;

export const ForgeCreateSessionInputSchema = Schema.Struct({
  sourceFilePath: Schema.String.pipe(Schema.nonEmptyString()),
});
export type ForgeCreateSessionInput = typeof ForgeCreateSessionInputSchema.Type;

export const ForgeCreateSessionResultSchema = Schema.Struct({
  session: ForgeSessionSchema,
  duplicateOfSessionId: Schema.Union(PositiveIntSchema, Schema.Null),
});
export type ForgeCreateSessionResult = typeof ForgeCreateSessionResultSchema.Type;

export const ForgeExtractTextInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
});
export type ForgeExtractTextInput = typeof ForgeExtractTextInputSchema.Type;

export const ForgeExtractTextResultSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  textLength: Schema.Number.pipe(Schema.nonNegative()),
  preview: Schema.String,
});
export type ForgeExtractTextResult = typeof ForgeExtractTextResultSchema.Type;

export class ForgeOperationError extends Schema.TaggedError<ForgeOperationError>(
  "@re/desktop/rpc/ForgeOperationError",
)("forge_operation_error", {
  message: Schema.String,
}) {}

export class ForgeSessionNotFoundError extends Schema.TaggedError<ForgeSessionNotFoundError>(
  "@re/desktop/rpc/ForgeSessionNotFoundError",
)("session_not_found", {
  sessionId: PositiveIntSchema,
}) {}

export const ForgeCreateSessionErrorSchema = ForgeOperationError;
export type ForgeCreateSessionError = typeof ForgeCreateSessionErrorSchema.Type;

export const ForgeExtractTextErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeSessionNotFoundError,
);
export type ForgeExtractTextError = typeof ForgeExtractTextErrorSchema.Type;
