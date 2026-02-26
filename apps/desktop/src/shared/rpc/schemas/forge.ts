import { Schema } from "@effect/schema";

const PositiveIntSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
const NonNegativeIntSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
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

export const ForgeChunkPageBoundarySchema = Schema.Struct({
  offset: NonNegativeIntSchema,
  page: PositiveIntSchema,
});
export type ForgeChunkPageBoundary = typeof ForgeChunkPageBoundarySchema.Type;

export const ForgeChunkSchema = Schema.Struct({
  id: PositiveIntSchema,
  sessionId: PositiveIntSchema,
  text: Schema.String,
  sequenceOrder: NonNegativeIntSchema,
  pageBoundaries: Schema.Array(ForgeChunkPageBoundarySchema),
  createdAt: Schema.String,
});
export type ForgeChunk = typeof ForgeChunkSchema.Type;

export const ForgeExtractTextResultSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  textLength: NonNegativeIntSchema,
  preview: Schema.String,
  totalPages: PositiveIntSchema,
  chunkCount: NonNegativeIntSchema,
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

export class ForgeSessionAlreadyChunkedError extends Schema.TaggedError<ForgeSessionAlreadyChunkedError>(
  "@re/desktop/rpc/ForgeSessionAlreadyChunkedError",
)("already_chunked", {
  sessionId: PositiveIntSchema,
  message: Schema.String,
}) {}

export class ForgeSessionBusyError extends Schema.TaggedError<ForgeSessionBusyError>(
  "@re/desktop/rpc/ForgeSessionBusyError",
)("session_busy", {
  sessionId: PositiveIntSchema,
  status: ForgeSessionStatusSchema,
}) {}

export class ForgeEmptySourceTextError extends Schema.TaggedError<ForgeEmptySourceTextError>(
  "@re/desktop/rpc/ForgeEmptySourceTextError",
)("empty_text", {
  sessionId: PositiveIntSchema,
  sourceFilePath: Schema.String,
  message: Schema.String,
}) {}

export class PdfExtractionError extends Schema.TaggedError<PdfExtractionError>(
  "@re/desktop/rpc/PdfExtractionError",
)("pdf_extraction_error", {
  sessionId: PositiveIntSchema,
  sourceFilePath: Schema.String,
  message: Schema.String,
}) {}

export const ForgeCreateSessionErrorSchema = ForgeOperationError;
export type ForgeCreateSessionError = typeof ForgeCreateSessionErrorSchema.Type;

export const ForgeExtractTextErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeSessionNotFoundError,
  ForgeSessionAlreadyChunkedError,
  ForgeSessionBusyError,
  ForgeEmptySourceTextError,
  PdfExtractionError,
);
export type ForgeExtractTextError = typeof ForgeExtractTextErrorSchema.Type;
