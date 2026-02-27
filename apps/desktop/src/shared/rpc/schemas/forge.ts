import { Schema } from "@effect/schema";
import { ModelIdSchema } from "./ai";

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

export const ForgePreviewChunksInputSchema = Schema.Struct({
  sourceFilePath: Schema.String.pipe(Schema.nonEmptyString()),
});
export type ForgePreviewChunksInput = typeof ForgePreviewChunksInputSchema.Type;

export const ForgePreviewChunksResultSchema = Schema.Struct({
  textLength: NonNegativeIntSchema,
  totalPages: PositiveIntSchema,
  chunkCount: NonNegativeIntSchema,
});
export type ForgePreviewChunksResult = typeof ForgePreviewChunksResultSchema.Type;

export const ForgeStartTopicExtractionInputSchema = Schema.Struct({
  sourceFilePath: Schema.String.pipe(Schema.nonEmptyString()),
  maxTopicsPerChunk: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(100)),
  ),
  model: Schema.optional(ModelIdSchema),
});
export type ForgeStartTopicExtractionInput = typeof ForgeStartTopicExtractionInputSchema.Type;

export const ForgeChunkTopicsSchema = Schema.Struct({
  chunkId: PositiveIntSchema,
  sequenceOrder: NonNegativeIntSchema,
  topics: Schema.Array(Schema.String),
});
export type ForgeChunkTopics = typeof ForgeChunkTopicsSchema.Type;

export const ForgeStartTopicExtractionResultSchema = Schema.Struct({
  session: ForgeSessionSchema,
  duplicateOfSessionId: Schema.Union(PositiveIntSchema, Schema.Null),
  extraction: ForgeExtractTextResultSchema,
  topicsByChunk: Schema.Array(ForgeChunkTopicsSchema),
});
export type ForgeStartTopicExtractionResult = typeof ForgeStartTopicExtractionResultSchema.Type;

export const ForgeGetTopicExtractionSnapshotInputSchema = Schema.Struct({
  sourceFilePath: Schema.String.pipe(Schema.nonEmptyString()),
});
export type ForgeGetTopicExtractionSnapshotInput =
  typeof ForgeGetTopicExtractionSnapshotInputSchema.Type;

export const ForgeGetTopicExtractionSnapshotResultSchema = Schema.Struct({
  session: Schema.Union(ForgeSessionSchema, Schema.Null),
  topicsByChunk: Schema.Array(ForgeChunkTopicsSchema),
});
export type ForgeGetTopicExtractionSnapshotResult =
  typeof ForgeGetTopicExtractionSnapshotResultSchema.Type;

export const ForgeTopicChunkExtractedEventSchema = Schema.Struct({
  sourceFilePath: Schema.String,
  sessionId: PositiveIntSchema,
  chunk: ForgeChunkTopicsSchema,
});
export type ForgeTopicChunkExtractedEvent = typeof ForgeTopicChunkExtractedEventSchema.Type;

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

export class ForgePreviewOperationError extends Schema.TaggedError<ForgePreviewOperationError>(
  "@re/desktop/rpc/ForgePreviewOperationError",
)("preview_operation_error", {
  sourceFilePath: Schema.String,
  message: Schema.String,
}) {}

export class ForgePreviewEmptySourceTextError extends Schema.TaggedError<ForgePreviewEmptySourceTextError>(
  "@re/desktop/rpc/ForgePreviewEmptySourceTextError",
)("preview_empty_text", {
  sourceFilePath: Schema.String,
  message: Schema.String,
}) {}

export class ForgePreviewPdfExtractionError extends Schema.TaggedError<ForgePreviewPdfExtractionError>(
  "@re/desktop/rpc/ForgePreviewPdfExtractionError",
)("preview_pdf_extraction_error", {
  sourceFilePath: Schema.String,
  message: Schema.String,
}) {}

export class ForgeTopicExtractionError extends Schema.TaggedError<ForgeTopicExtractionError>(
  "@re/desktop/rpc/ForgeTopicExtractionError",
)("topic_extraction_error", {
  sessionId: PositiveIntSchema,
  chunkId: Schema.optional(PositiveIntSchema),
  sequenceOrder: Schema.optional(NonNegativeIntSchema),
  message: Schema.String,
}) {}

export class ForgeSessionOperationError extends Schema.TaggedError<ForgeSessionOperationError>(
  "@re/desktop/rpc/ForgeSessionOperationError",
)("session_operation_error", {
  sessionId: PositiveIntSchema,
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

export const ForgePreviewChunksErrorSchema = Schema.Union(
  ForgePreviewOperationError,
  ForgePreviewEmptySourceTextError,
  ForgePreviewPdfExtractionError,
);
export type ForgePreviewChunksError = typeof ForgePreviewChunksErrorSchema.Type;

export const ForgeStartTopicExtractionErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeEmptySourceTextError,
  PdfExtractionError,
  ForgeTopicExtractionError,
  ForgeSessionOperationError,
);
export type ForgeStartTopicExtractionError = typeof ForgeStartTopicExtractionErrorSchema.Type;

export const ForgeGetTopicExtractionSnapshotErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeSessionOperationError,
);
export type ForgeGetTopicExtractionSnapshotError =
  typeof ForgeGetTopicExtractionSnapshotErrorSchema.Type;
