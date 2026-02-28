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

export const ForgeTopicRefSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  chunkId: PositiveIntSchema,
  topicIndex: NonNegativeIntSchema,
});
export type ForgeTopicRef = typeof ForgeTopicRefSchema.Type;

export const ForgeTopicCardsStatusSchema = Schema.Literal(
  "idle",
  "generating",
  "generated",
  "error",
);
export type ForgeTopicCardsStatus = typeof ForgeTopicCardsStatusSchema.Type;

export const ForgeGeneratedCardSchema = Schema.Struct({
  id: PositiveIntSchema,
  question: Schema.String,
  answer: Schema.String,
});
export type ForgeGeneratedCard = typeof ForgeGeneratedCardSchema.Type;

export const ForgeTopicCardsSummarySchema = Schema.Struct({
  topicId: PositiveIntSchema,
  chunkId: PositiveIntSchema,
  sequenceOrder: NonNegativeIntSchema,
  topicIndex: NonNegativeIntSchema,
  topicText: Schema.String,
  status: ForgeTopicCardsStatusSchema,
  errorMessage: NullableStringSchema,
  cardCount: NonNegativeIntSchema,
  generationRevision: NonNegativeIntSchema,
});
export type ForgeTopicCardsSummary = typeof ForgeTopicCardsSummarySchema.Type;

export const ForgeGetCardsSnapshotInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
});
export type ForgeGetCardsSnapshotInput = typeof ForgeGetCardsSnapshotInputSchema.Type;

export const ForgeGetCardsSnapshotResultSchema = Schema.Struct({
  topics: Schema.Array(ForgeTopicCardsSummarySchema),
});
export type ForgeGetCardsSnapshotResult = typeof ForgeGetCardsSnapshotResultSchema.Type;

export const ForgeGetTopicCardsInputSchema = ForgeTopicRefSchema;
export type ForgeGetTopicCardsInput = typeof ForgeGetTopicCardsInputSchema.Type;

export const ForgeGetTopicCardsResultSchema = Schema.Struct({
  topic: ForgeTopicCardsSummarySchema,
  cards: Schema.Array(ForgeGeneratedCardSchema),
});
export type ForgeGetTopicCardsResult = typeof ForgeGetTopicCardsResultSchema.Type;

export const ForgeGenerateTopicCardsInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  chunkId: PositiveIntSchema,
  topicIndex: NonNegativeIntSchema,
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});
export type ForgeGenerateTopicCardsInput = typeof ForgeGenerateTopicCardsInputSchema.Type;

export const ForgeGenerateTopicCardsResultSchema = ForgeGetTopicCardsResultSchema;
export type ForgeGenerateTopicCardsResult = typeof ForgeGenerateTopicCardsResultSchema.Type;

export const ForgePermutationSchema = Schema.Struct({
  id: PositiveIntSchema,
  question: Schema.String,
  answer: Schema.String,
});
export type ForgePermutation = typeof ForgePermutationSchema.Type;

export const ForgeGetCardPermutationsInputSchema = Schema.Struct({
  sourceCardId: PositiveIntSchema,
});
export type ForgeGetCardPermutationsInput = typeof ForgeGetCardPermutationsInputSchema.Type;

export const ForgeGetCardPermutationsResultSchema = Schema.Struct({
  sourceCardId: PositiveIntSchema,
  permutations: Schema.Array(ForgePermutationSchema),
});
export type ForgeGetCardPermutationsResult = typeof ForgeGetCardPermutationsResultSchema.Type;

export const ForgeGenerateCardPermutationsInputSchema = Schema.Struct({
  sourceCardId: PositiveIntSchema,
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});
export type ForgeGenerateCardPermutationsInput =
  typeof ForgeGenerateCardPermutationsInputSchema.Type;

export const ForgeGenerateCardPermutationsResultSchema = ForgeGetCardPermutationsResultSchema;
export type ForgeGenerateCardPermutationsResult =
  typeof ForgeGenerateCardPermutationsResultSchema.Type;

export const ForgeCardClozeSchema = Schema.Struct({
  sourceCardId: PositiveIntSchema,
  cloze: Schema.String,
});
export type ForgeCardCloze = typeof ForgeCardClozeSchema.Type;

export const ForgeGetCardClozeInputSchema = Schema.Struct({
  sourceCardId: PositiveIntSchema,
});
export type ForgeGetCardClozeInput = typeof ForgeGetCardClozeInputSchema.Type;

export const ForgeGetCardClozeResultSchema = Schema.Struct({
  sourceCardId: PositiveIntSchema,
  cloze: Schema.Union(Schema.String, Schema.Null),
});
export type ForgeGetCardClozeResult = typeof ForgeGetCardClozeResultSchema.Type;

export const ForgeGenerateCardClozeInputSchema = Schema.Struct({
  sourceCardId: PositiveIntSchema,
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});
export type ForgeGenerateCardClozeInput = typeof ForgeGenerateCardClozeInputSchema.Type;

export const ForgeGenerateCardClozeResultSchema = ForgeCardClozeSchema;
export type ForgeGenerateCardClozeResult = typeof ForgeGenerateCardClozeResultSchema.Type;

export const ForgeUpdateCardInputSchema = Schema.Struct({
  cardId: PositiveIntSchema,
  question: Schema.String,
  answer: Schema.String,
});
export type ForgeUpdateCardInput = typeof ForgeUpdateCardInputSchema.Type;

export const ForgeUpdateCardResultSchema = Schema.Struct({
  card: ForgeGeneratedCardSchema,
});
export type ForgeUpdateCardResult = typeof ForgeUpdateCardResultSchema.Type;

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

export class ForgeTopicNotFoundError extends Schema.TaggedError<ForgeTopicNotFoundError>(
  "@re/desktop/rpc/ForgeTopicNotFoundError",
)("topic_not_found", {
  sessionId: PositiveIntSchema,
  chunkId: PositiveIntSchema,
  topicIndex: NonNegativeIntSchema,
}) {}

export class ForgeCardNotFoundError extends Schema.TaggedError<ForgeCardNotFoundError>(
  "@re/desktop/rpc/ForgeCardNotFoundError",
)("card_not_found", {
  sourceCardId: PositiveIntSchema,
}) {}

export class ForgeCardGenerationError extends Schema.TaggedError<ForgeCardGenerationError>(
  "@re/desktop/rpc/ForgeCardGenerationError",
)("card_generation_error", {
  sessionId: PositiveIntSchema,
  chunkId: PositiveIntSchema,
  topicIndex: NonNegativeIntSchema,
  message: Schema.String,
}) {}

export class ForgeTopicAlreadyGeneratingError extends Schema.TaggedError<ForgeTopicAlreadyGeneratingError>(
  "@re/desktop/rpc/ForgeTopicAlreadyGeneratingError",
)("topic_already_generating", {
  sessionId: PositiveIntSchema,
  chunkId: PositiveIntSchema,
  topicIndex: NonNegativeIntSchema,
}) {}

export class ForgePermutationGenerationError extends Schema.TaggedError<ForgePermutationGenerationError>(
  "@re/desktop/rpc/ForgePermutationGenerationError",
)("permutation_generation_error", {
  sourceCardId: PositiveIntSchema,
  message: Schema.String,
}) {}

export class ForgeClozeGenerationError extends Schema.TaggedError<ForgeClozeGenerationError>(
  "@re/desktop/rpc/ForgeClozeGenerationError",
)("cloze_generation_error", {
  sourceCardId: PositiveIntSchema,
  message: Schema.String,
}) {}

export const ForgeSessionSummarySchema = Schema.Struct({
  id: PositiveIntSchema,
  sourceFilePath: Schema.String,
  status: ForgeSessionStatusSchema,
  errorMessage: NullableStringSchema,
  topicCount: NonNegativeIntSchema,
  cardCount: NonNegativeIntSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ForgeSessionSummary = typeof ForgeSessionSummarySchema.Type;

export const ForgeListSessionsInputSchema = Schema.Struct({});
export type ForgeListSessionsInput = typeof ForgeListSessionsInputSchema.Type;

export const ForgeListSessionsResultSchema = Schema.Struct({
  sessions: Schema.Array(ForgeSessionSummarySchema),
});
export type ForgeListSessionsResult = typeof ForgeListSessionsResultSchema.Type;

export const ForgeListSessionsErrorSchema = ForgeOperationError;
export type ForgeListSessionsError = typeof ForgeListSessionsErrorSchema.Type;

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

export const ForgeGetCardsSnapshotErrorSchema = Schema.Union(
  ForgeSessionNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGetCardsSnapshotError = typeof ForgeGetCardsSnapshotErrorSchema.Type;

export const ForgeGetTopicCardsErrorSchema = Schema.Union(
  ForgeTopicNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGetTopicCardsError = typeof ForgeGetTopicCardsErrorSchema.Type;

export const ForgeGenerateTopicCardsErrorSchema = Schema.Union(
  ForgeTopicNotFoundError,
  ForgeTopicAlreadyGeneratingError,
  ForgeCardGenerationError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGenerateTopicCardsError = typeof ForgeGenerateTopicCardsErrorSchema.Type;

export const ForgeGetCardPermutationsErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGetCardPermutationsError = typeof ForgeGetCardPermutationsErrorSchema.Type;

export const ForgeGenerateCardPermutationsErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgePermutationGenerationError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGenerateCardPermutationsError =
  typeof ForgeGenerateCardPermutationsErrorSchema.Type;

export const ForgeGetCardClozeErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGetCardClozeError = typeof ForgeGetCardClozeErrorSchema.Type;

export const ForgeGenerateCardClozeErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeClozeGenerationError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGenerateCardClozeError = typeof ForgeGenerateCardClozeErrorSchema.Type;

export const ForgeUpdateCardErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeUpdateCardError = typeof ForgeUpdateCardErrorSchema.Type;
