import { Schema } from "@effect/schema";
import { ModelIdSchema } from "./ai";

const PositiveIntSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
const NonNegativeIntSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const NullableStringSchema = Schema.Union(Schema.String, Schema.Null);
const NonEmptyStringSchema = Schema.String.pipe(Schema.nonEmptyString());

export const FORGE_CHUNK_SIZE = 12_000;

export const ForgeSourceKindSchema = Schema.Literal("pdf", "text");
export type ForgeSourceKind = typeof ForgeSourceKindSchema.Type;

export const ForgePdfSourceInputSchema = Schema.Struct({
  kind: Schema.Literal("pdf"),
  sourceFilePath: NonEmptyStringSchema,
});
export type ForgePdfSourceInput = typeof ForgePdfSourceInputSchema.Type;

export const ForgeTextSourceInputSchema = Schema.Struct({
  kind: Schema.Literal("text"),
  text: NonEmptyStringSchema,
  sourceLabel: Schema.optional(NonEmptyStringSchema),
});
export type ForgeTextSourceInput = typeof ForgeTextSourceInputSchema.Type;

export const ForgeSourceInputSchema = Schema.Union(
  ForgePdfSourceInputSchema,
  ForgeTextSourceInputSchema,
);
export type ForgeSourceInput = typeof ForgeSourceInputSchema.Type;

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
  sourceLabel: NonEmptyStringSchema,
  sourceFilePath: NullableStringSchema,
  deckPath: NullableStringSchema,
  sourceFingerprint: Schema.String,
  status: ForgeSessionStatusSchema,
  errorMessage: NullableStringSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type ForgeSession = typeof ForgeSessionSchema.Type;

export const ForgeTopicFamilySchema = Schema.Literal("detail", "synthesis");
export type ForgeTopicFamily = typeof ForgeTopicFamilySchema.Type;

export const ForgeCreateSessionInputSchema = Schema.Struct({
  source: ForgeSourceInputSchema,
});
export type ForgeCreateSessionInput = typeof ForgeCreateSessionInputSchema.Type;

export const ForgeCreateSessionResultSchema = Schema.Struct({
  session: ForgeSessionSchema,
  duplicateOfSessionId: Schema.Union(PositiveIntSchema, Schema.Null),
});
export type ForgeCreateSessionResult = typeof ForgeCreateSessionResultSchema.Type;

export const ForgeExtractTextInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  source: ForgeSourceInputSchema,
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
  source: ForgeSourceInputSchema,
});
export type ForgePreviewChunksInput = typeof ForgePreviewChunksInputSchema.Type;

export const ForgePreviewChunksResultSchema = Schema.Struct({
  textLength: NonNegativeIntSchema,
  totalPages: PositiveIntSchema,
  chunkCount: NonNegativeIntSchema,
});
export type ForgePreviewChunksResult = typeof ForgePreviewChunksResultSchema.Type;

export const ForgeStartTopicExtractionInputSchema = Schema.Struct({
  source: ForgeSourceInputSchema,
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

export const ForgeGetTopicExtractionSnapshotInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
});
export type ForgeGetTopicExtractionSnapshotInput =
  typeof ForgeGetTopicExtractionSnapshotInputSchema.Type;

export const ForgeTopicSummarySchema = Schema.Struct({
  topicId: PositiveIntSchema,
  sessionId: PositiveIntSchema,
  family: ForgeTopicFamilySchema,
  chunkId: Schema.Union(PositiveIntSchema, Schema.Null),
  chunkSequenceOrder: Schema.Union(NonNegativeIntSchema, Schema.Null),
  topicIndex: NonNegativeIntSchema,
  topicText: Schema.String,
  selected: Schema.Boolean,
});
export type ForgeTopicSummary = typeof ForgeTopicSummarySchema.Type;

export const ForgeTopicGroupSchema = Schema.Struct({
  groupId: Schema.String,
  groupKind: Schema.Literal("chunk", "section"),
  family: ForgeTopicFamilySchema,
  title: Schema.String,
  displayOrder: NonNegativeIntSchema,
  chunkId: Schema.Union(PositiveIntSchema, Schema.Null),
  topics: Schema.Array(ForgeTopicSummarySchema),
});
export type ForgeTopicGroup = typeof ForgeTopicGroupSchema.Type;

export const ForgeTopicExtractionOutcomeSchema = Schema.Struct({
  family: ForgeTopicFamilySchema,
  status: Schema.Literal("extracted", "error"),
  errorMessage: NullableStringSchema,
});
export type ForgeTopicExtractionOutcome = typeof ForgeTopicExtractionOutcomeSchema.Type;

export const ForgeStartTopicExtractionResultSchema = Schema.Struct({
  session: ForgeSessionSchema,
  duplicateOfSessionId: Schema.Union(PositiveIntSchema, Schema.Null),
  extraction: ForgeExtractTextResultSchema,
  outcomes: Schema.Array(ForgeTopicExtractionOutcomeSchema),
  groups: Schema.Array(ForgeTopicGroupSchema),
});
export type ForgeStartTopicExtractionResult = typeof ForgeStartTopicExtractionResultSchema.Type;

export const ForgeGetTopicExtractionSnapshotResultSchema = Schema.Struct({
  session: ForgeSessionSchema,
  outcomes: Schema.Array(ForgeTopicExtractionOutcomeSchema),
  groups: Schema.Array(ForgeTopicGroupSchema),
});
export type ForgeGetTopicExtractionSnapshotResult =
  typeof ForgeGetTopicExtractionSnapshotResultSchema.Type;

export const ForgeTopicRefSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  topicId: PositiveIntSchema,
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
  addedToDeck: Schema.Boolean,
});
export type ForgeGeneratedCard = typeof ForgeGeneratedCardSchema.Type;

export const ForgeTopicCardsSummarySchema = Schema.Struct({
  topicId: PositiveIntSchema,
  sessionId: PositiveIntSchema,
  family: ForgeTopicFamilySchema,
  chunkId: Schema.Union(PositiveIntSchema, Schema.Null),
  chunkSequenceOrder: Schema.Union(NonNegativeIntSchema, Schema.Null),
  topicIndex: NonNegativeIntSchema,
  topicText: Schema.String,
  status: ForgeTopicCardsStatusSchema,
  errorMessage: NullableStringSchema,
  cardCount: NonNegativeIntSchema,
  addedCount: NonNegativeIntSchema,
  generationRevision: NonNegativeIntSchema,
  selected: Schema.Boolean,
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
  topicId: PositiveIntSchema,
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});
export type ForgeGenerateTopicCardsInput = typeof ForgeGenerateTopicCardsInputSchema.Type;

export const ForgeGenerateTopicCardsResultSchema = ForgeGetTopicCardsResultSchema;
export type ForgeGenerateTopicCardsResult = typeof ForgeGenerateTopicCardsResultSchema.Type;

export const ForgeGenerateSelectedTopicCardsInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  topicIds: Schema.Array(PositiveIntSchema),
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
  concurrencyLimit: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(8)),
  ),
});
export type ForgeGenerateSelectedTopicCardsInput =
  typeof ForgeGenerateSelectedTopicCardsInputSchema.Type;

export const ForgeGenerateSelectedTopicCardsTopicStatusSchema = Schema.Literal(
  "generated",
  "already_generating",
  "topic_not_found",
  "error",
);
export type ForgeGenerateSelectedTopicCardsTopicStatus =
  typeof ForgeGenerateSelectedTopicCardsTopicStatusSchema.Type;

export const ForgeGenerateSelectedTopicCardsTopicResultSchema = Schema.Struct({
  topicId: PositiveIntSchema,
  status: ForgeGenerateSelectedTopicCardsTopicStatusSchema,
  message: NullableStringSchema,
});
export type ForgeGenerateSelectedTopicCardsTopicResult =
  typeof ForgeGenerateSelectedTopicCardsTopicResultSchema.Type;

export const ForgeGenerateSelectedTopicCardsResultSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  results: Schema.Array(ForgeGenerateSelectedTopicCardsTopicResultSchema),
});
export type ForgeGenerateSelectedTopicCardsResult =
  typeof ForgeGenerateSelectedTopicCardsResultSchema.Type;

export const DerivationKindSchema = Schema.Literal("permutation", "expansion");
export type DerivationKind = typeof DerivationKindSchema.Type;

export const DerivationParentRefSchema = Schema.Union(
  Schema.Struct({ cardId: PositiveIntSchema }),
  Schema.Struct({ derivationId: PositiveIntSchema }),
);
export type DerivationParentRef = typeof DerivationParentRefSchema.Type;

export const isCardParentRef = (ref: DerivationParentRef): ref is { readonly cardId: number } =>
  "cardId" in ref;

export const sameDerivationParentRef = (
  left: DerivationParentRef,
  right: DerivationParentRef,
): boolean =>
  ("cardId" in left && "cardId" in right && left.cardId === right.cardId) ||
  ("derivationId" in left && "derivationId" in right && left.derivationId === right.derivationId);

export const toDerivationParentRefKey = (ref: DerivationParentRef): string =>
  "cardId" in ref ? `card:${ref.cardId}` : `derivation:${ref.derivationId}`;

export const ForgeDerivationSchema = Schema.Struct({
  id: PositiveIntSchema,
  rootCardId: PositiveIntSchema,
  parentDerivationId: Schema.Union(PositiveIntSchema, Schema.Null),
  kind: DerivationKindSchema,
  derivationOrder: NonNegativeIntSchema,
  question: Schema.String,
  answer: Schema.String,
  instruction: Schema.Union(Schema.String, Schema.Null),
  addedCount: NonNegativeIntSchema,
});
export type ForgeDerivation = typeof ForgeDerivationSchema.Type;

export const ForgeGetDerivedCardsInputSchema = Schema.Struct({
  parent: DerivationParentRefSchema,
  kind: DerivationKindSchema,
});
export type ForgeGetDerivedCardsInput = typeof ForgeGetDerivedCardsInputSchema.Type;

export const ForgeGetDerivedCardsResultSchema = Schema.Struct({
  derivations: Schema.Array(ForgeDerivationSchema),
});
export type ForgeGetDerivedCardsResult = typeof ForgeGetDerivedCardsResultSchema.Type;

export const ForgeGenerateDerivedCardsInputSchema = Schema.Struct({
  parent: DerivationParentRefSchema,
  kind: DerivationKindSchema,
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
  confirmed: Schema.optional(Schema.Boolean),
});
export type ForgeGenerateDerivedCardsInput = typeof ForgeGenerateDerivedCardsInputSchema.Type;

export const ForgeGenerateDerivedCardsResultSchema = Schema.Union(
  ForgeGetDerivedCardsResultSchema,
  Schema.Struct({
    confirmRequired: Schema.Literal(true),
    descendantCount: NonNegativeIntSchema,
  }),
);
export type ForgeGenerateDerivedCardsResult = typeof ForgeGenerateDerivedCardsResultSchema.Type;

export const ForgeCardClozeSchema = Schema.Struct({
  source: DerivationParentRefSchema,
  cloze: Schema.String,
  addedCount: NonNegativeIntSchema,
});
export type ForgeCardCloze = typeof ForgeCardClozeSchema.Type;

export const ForgeGetCardClozeInputSchema = Schema.Struct({
  source: DerivationParentRefSchema,
});
export type ForgeGetCardClozeInput = typeof ForgeGetCardClozeInputSchema.Type;

export const ForgeGetCardClozeResultSchema = Schema.Struct({
  source: DerivationParentRefSchema,
  cloze: Schema.Union(Schema.String, Schema.Null),
  addedCount: NonNegativeIntSchema,
});
export type ForgeGetCardClozeResult = typeof ForgeGetCardClozeResultSchema.Type;

export const ForgeGenerateCardClozeInputSchema = Schema.Struct({
  source: DerivationParentRefSchema,
  sourceQuestion: Schema.optional(Schema.String),
  sourceAnswer: Schema.optional(Schema.String),
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});
export type ForgeGenerateCardClozeInput = typeof ForgeGenerateCardClozeInputSchema.Type;

export const ForgeGenerateCardClozeResultSchema = ForgeCardClozeSchema;
export type ForgeGenerateCardClozeResult = typeof ForgeGenerateCardClozeResultSchema.Type;

export const ForgeReformulateCardInputSchema = Schema.Struct({
  source: DerivationParentRefSchema,
  sourceQuestion: Schema.optional(Schema.String),
  sourceAnswer: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});
export type ForgeReformulateCardInput = typeof ForgeReformulateCardInputSchema.Type;

export const ForgeReformulateCardResultSchema = Schema.Union(
  Schema.Struct({
    source: Schema.Struct({ cardId: PositiveIntSchema }),
    card: ForgeGeneratedCardSchema,
  }),
  Schema.Struct({
    source: Schema.Struct({ derivationId: PositiveIntSchema }),
    derivation: ForgeDerivationSchema,
  }),
);
export type ForgeReformulateCardResult = typeof ForgeReformulateCardResultSchema.Type;

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

export const ForgeSaveTopicSelectionsInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  topicIds: Schema.Array(PositiveIntSchema),
});
export type ForgeSaveTopicSelectionsInput = typeof ForgeSaveTopicSelectionsInputSchema.Type;

export const ForgeSaveTopicSelectionsResultSchema = Schema.Struct({});
export type ForgeSaveTopicSelectionsResult = typeof ForgeSaveTopicSelectionsResultSchema.Type;

export const ForgeSetSessionDeckPathInputSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  deckPath: NullableStringSchema,
});
export type ForgeSetSessionDeckPathInput = typeof ForgeSetSessionDeckPathInputSchema.Type;

export const ForgeSetSessionDeckPathResultSchema = Schema.Struct({});
export type ForgeSetSessionDeckPathResult = typeof ForgeSetSessionDeckPathResultSchema.Type;

export const ForgeTopicChunkExtractedEventSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
  chunk: ForgeChunkTopicsSchema,
});

export const ForgeExtractionSessionCreatedEventSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
});
export const ForgeSynthesisTopicsExtractedEventSchema = Schema.Struct({
  sessionId: PositiveIntSchema,
});
export type ForgeTopicChunkExtractedEvent = typeof ForgeTopicChunkExtractedEventSchema.Type;
export type ForgeExtractionSessionCreatedEvent =
  typeof ForgeExtractionSessionCreatedEventSchema.Type;
export type ForgeSynthesisTopicsExtractedEvent =
  typeof ForgeSynthesisTopicsExtractedEventSchema.Type;

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
  sessionId: Schema.optional(PositiveIntSchema),
  sourceKind: ForgeSourceKindSchema,
  sourceLabel: NonEmptyStringSchema,
  message: Schema.String,
}) {}

export class ForgeSourceResolveError extends Schema.TaggedError<ForgeSourceResolveError>(
  "@re/desktop/rpc/ForgeSourceResolveError",
)("source_resolve_error", {
  sessionId: Schema.optional(PositiveIntSchema),
  sourceKind: ForgeSourceKindSchema,
  sourceLabel: NonEmptyStringSchema,
  message: Schema.String,
}) {}

export class ForgePreviewOperationError extends Schema.TaggedError<ForgePreviewOperationError>(
  "@re/desktop/rpc/ForgePreviewOperationError",
)("preview_operation_error", {
  sourceKind: ForgeSourceKindSchema,
  sourceLabel: NonEmptyStringSchema,
  message: Schema.String,
}) {}

export class ForgePreviewEmptySourceTextError extends Schema.TaggedError<ForgePreviewEmptySourceTextError>(
  "@re/desktop/rpc/ForgePreviewEmptySourceTextError",
)("preview_empty_text", {
  sourceKind: ForgeSourceKindSchema,
  sourceLabel: NonEmptyStringSchema,
  message: Schema.String,
}) {}

export class ForgeSourceMismatchError extends Schema.TaggedError<ForgeSourceMismatchError>(
  "@re/desktop/rpc/ForgeSourceMismatchError",
)("source_mismatch", {
  sessionId: PositiveIntSchema,
  expectedSourceKind: ForgeSourceKindSchema,
  expectedSourceLabel: NonEmptyStringSchema,
  actualSourceKind: ForgeSourceKindSchema,
  actualSourceLabel: NonEmptyStringSchema,
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
  topicId: PositiveIntSchema,
}) {}

export class ForgeCardNotFoundError extends Schema.TaggedError<ForgeCardNotFoundError>(
  "@re/desktop/rpc/ForgeCardNotFoundError",
)("card_not_found", {
  sourceCardId: PositiveIntSchema,
}) {}

export class ForgeDerivationNotFoundError extends Schema.TaggedError<ForgeDerivationNotFoundError>(
  "@re/desktop/rpc/ForgeDerivationNotFoundError",
)("derivation_not_found", {
  derivationId: PositiveIntSchema,
}) {}

export class ForgeCardGenerationError extends Schema.TaggedError<ForgeCardGenerationError>(
  "@re/desktop/rpc/ForgeCardGenerationError",
)("card_generation_error", {
  sessionId: PositiveIntSchema,
  topicId: PositiveIntSchema,
  message: Schema.String,
}) {}

export class ForgeTopicAlreadyGeneratingError extends Schema.TaggedError<ForgeTopicAlreadyGeneratingError>(
  "@re/desktop/rpc/ForgeTopicAlreadyGeneratingError",
)("topic_already_generating", {
  sessionId: PositiveIntSchema,
  topicId: PositiveIntSchema,
}) {}

export class ForgeDerivationAlreadyGeneratingError extends Schema.TaggedError<ForgeDerivationAlreadyGeneratingError>(
  "@re/desktop/rpc/ForgeDerivationAlreadyGeneratingError",
)("derivation_already_generating", {
  parent: DerivationParentRefSchema,
  kind: DerivationKindSchema,
}) {}

export class ForgeDerivationGenerationError extends Schema.TaggedError<ForgeDerivationGenerationError>(
  "@re/desktop/rpc/ForgeDerivationGenerationError",
)("derivation_generation_error", {
  parent: DerivationParentRefSchema,
  kind: DerivationKindSchema,
  message: Schema.String,
}) {}

export class ForgeClozeGenerationError extends Schema.TaggedError<ForgeClozeGenerationError>(
  "@re/desktop/rpc/ForgeClozeGenerationError",
)("cloze_generation_error", {
  source: DerivationParentRefSchema,
  message: Schema.String,
}) {}

export class ForgeCardReformulationError extends Schema.TaggedError<ForgeCardReformulationError>(
  "@re/desktop/rpc/ForgeCardReformulationError",
)("card_reformulation_error", {
  source: DerivationParentRefSchema,
  message: Schema.String,
}) {}

export const ForgeSessionSummarySchema = Schema.Struct({
  id: PositiveIntSchema,
  sourceKind: ForgeSourceKindSchema,
  sourceLabel: NonEmptyStringSchema,
  sourceFilePath: NullableStringSchema,
  deckPath: NullableStringSchema,
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

export const ForgeCreateSessionErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeEmptySourceTextError,
  ForgeSourceResolveError,
);
export type ForgeCreateSessionError = typeof ForgeCreateSessionErrorSchema.Type;

export const ForgeExtractTextErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeSessionNotFoundError,
  ForgeSessionAlreadyChunkedError,
  ForgeSessionBusyError,
  ForgeSourceMismatchError,
  ForgeEmptySourceTextError,
  ForgeSourceResolveError,
);
export type ForgeExtractTextError = typeof ForgeExtractTextErrorSchema.Type;

export const ForgePreviewChunksErrorSchema = Schema.Union(
  ForgePreviewOperationError,
  ForgePreviewEmptySourceTextError,
  ForgeSourceResolveError,
);
export type ForgePreviewChunksError = typeof ForgePreviewChunksErrorSchema.Type;

export const ForgeStartTopicExtractionErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeEmptySourceTextError,
  ForgeSourceResolveError,
  ForgeSourceMismatchError,
  ForgeTopicExtractionError,
  ForgeSessionOperationError,
);
export type ForgeStartTopicExtractionError = typeof ForgeStartTopicExtractionErrorSchema.Type;

export const ForgeGetTopicExtractionSnapshotErrorSchema = Schema.Union(
  ForgeOperationError,
  ForgeSessionNotFoundError,
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
  ForgeSessionNotFoundError,
  ForgeTopicNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGetTopicCardsError = typeof ForgeGetTopicCardsErrorSchema.Type;

export const ForgeGenerateTopicCardsErrorSchema = Schema.Union(
  ForgeSessionNotFoundError,
  ForgeTopicNotFoundError,
  ForgeTopicAlreadyGeneratingError,
  ForgeCardGenerationError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGenerateTopicCardsError = typeof ForgeGenerateTopicCardsErrorSchema.Type;

export const ForgeGenerateSelectedTopicCardsErrorSchema = Schema.Union(
  ForgeSessionNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGenerateSelectedTopicCardsError =
  typeof ForgeGenerateSelectedTopicCardsErrorSchema.Type;

export const ForgeGetDerivedCardsErrorSchema = Schema.Union(
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGetDerivedCardsError = typeof ForgeGetDerivedCardsErrorSchema.Type;

export const ForgeGenerateDerivedCardsErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeDerivationNotFoundError,
  ForgeDerivationAlreadyGeneratingError,
  ForgeDerivationGenerationError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGenerateDerivedCardsError = typeof ForgeGenerateDerivedCardsErrorSchema.Type;

export const ForgeGetCardClozeErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeDerivationNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGetCardClozeError = typeof ForgeGetCardClozeErrorSchema.Type;

export const ForgeGenerateCardClozeErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeDerivationNotFoundError,
  ForgeClozeGenerationError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeGenerateCardClozeError = typeof ForgeGenerateCardClozeErrorSchema.Type;

export const ForgeReformulateCardErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeDerivationNotFoundError,
  ForgeCardReformulationError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeReformulateCardError = typeof ForgeReformulateCardErrorSchema.Type;

export const ForgeUpdateCardErrorSchema = Schema.Union(
  ForgeCardNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeUpdateCardError = typeof ForgeUpdateCardErrorSchema.Type;

export const ForgeSaveTopicSelectionsErrorSchema = Schema.Union(
  ForgeSessionNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeSaveTopicSelectionsError = typeof ForgeSaveTopicSelectionsErrorSchema.Type;

export const ForgeSetSessionDeckPathErrorSchema = Schema.Union(
  ForgeSessionNotFoundError,
  ForgeSessionOperationError,
  ForgeOperationError,
);
export type ForgeSetSessionDeckPathError = typeof ForgeSetSessionDeckPathErrorSchema.Type;

export const ForgeUpdateDerivationInputSchema = Schema.Struct({
  derivationId: PositiveIntSchema,
  question: Schema.String,
  answer: Schema.String,
});
export type ForgeUpdateDerivationInput = typeof ForgeUpdateDerivationInputSchema.Type;

export const ForgeUpdateDerivationResultSchema = Schema.Struct({
  derivation: ForgeDerivationSchema,
});
export type ForgeUpdateDerivationResult = typeof ForgeUpdateDerivationResultSchema.Type;

export const ForgeUpdateDerivationErrorSchema = Schema.Union(
  ForgeDerivationNotFoundError,
  ForgeOperationError,
);
export type ForgeUpdateDerivationError = typeof ForgeUpdateDerivationErrorSchema.Type;

export const ForgeAddCardToDeckInputSchema = Schema.Struct({
  deckPath: Schema.String.pipe(Schema.nonEmptyString()),
  content: Schema.String.pipe(Schema.nonEmptyString()),
  cardType: Schema.Literal("qa", "cloze"),
  sourceCardId: Schema.optional(PositiveIntSchema),
  derivationId: Schema.optional(PositiveIntSchema),
});
export type ForgeAddCardToDeckInput = typeof ForgeAddCardToDeckInputSchema.Type;

export const ForgeAddCardToDeckResultSchema = Schema.Struct({
  cardIds: Schema.Array(Schema.String),
});
export type ForgeAddCardToDeckResult = typeof ForgeAddCardToDeckResultSchema.Type;

export const ForgeAddCardToDeckErrorSchema = ForgeOperationError;
export type ForgeAddCardToDeckError = typeof ForgeAddCardToDeckErrorSchema.Type;

export const toForgeGetDerivedCardsErrorMessage = (error: ForgeGetDerivedCardsError): string => {
  switch (error._tag) {
    case "session_operation_error":
    case "forge_operation_error":
      return error.message;
  }
};

export const mapForgeGetDerivedCardsErrorToError = (
  error: ForgeGetDerivedCardsError | Error,
): Error => ("_tag" in error ? new Error(toForgeGetDerivedCardsErrorMessage(error)) : error);

export const toForgeGenerateDerivedCardsErrorMessage = (
  error: ForgeGenerateDerivedCardsError,
): string => {
  switch (error._tag) {
    case "card_not_found":
      return `Card not found: ${error.sourceCardId}`;
    case "derivation_not_found":
      return `Derivation not found: ${error.derivationId}`;
    case "derivation_already_generating":
      return "Derived cards are already generating.";
    case "derivation_generation_error":
    case "session_operation_error":
    case "forge_operation_error":
      return error.message;
  }
};

export const mapForgeGenerateDerivedCardsErrorToError = (
  error: ForgeGenerateDerivedCardsError | Error,
): Error => ("_tag" in error ? new Error(toForgeGenerateDerivedCardsErrorMessage(error)) : error);

export const toForgeGetCardClozeErrorMessage = (error: ForgeGetCardClozeError): string => {
  switch (error._tag) {
    case "card_not_found":
      return `Card not found: ${error.sourceCardId}`;
    case "derivation_not_found":
      return `Derivation not found: ${error.derivationId}`;
    case "session_operation_error":
    case "forge_operation_error":
      return error.message;
  }
};

export const mapForgeGetCardClozeErrorToError = (error: ForgeGetCardClozeError | Error): Error =>
  "_tag" in error ? new Error(toForgeGetCardClozeErrorMessage(error)) : error;

export const toForgeGenerateCardClozeErrorMessage = (
  error: ForgeGenerateCardClozeError,
): string => {
  switch (error._tag) {
    case "card_not_found":
      return `Card not found: ${error.sourceCardId}`;
    case "derivation_not_found":
      return `Derivation not found: ${error.derivationId}`;
    case "cloze_generation_error":
    case "session_operation_error":
    case "forge_operation_error":
      return error.message;
  }
};

export const mapForgeGenerateCardClozeErrorToError = (
  error: ForgeGenerateCardClozeError | Error,
): Error => ("_tag" in error ? new Error(toForgeGenerateCardClozeErrorMessage(error)) : error);

export const toForgeReformulateCardErrorMessage = (error: ForgeReformulateCardError): string => {
  switch (error._tag) {
    case "card_not_found":
      return `Card not found: ${error.sourceCardId}`;
    case "derivation_not_found":
      return `Derivation not found: ${error.derivationId}`;
    case "card_reformulation_error":
    case "session_operation_error":
    case "forge_operation_error":
      return error.message;
  }
};

export const mapForgeReformulateCardErrorToError = (
  error: ForgeReformulateCardError | Error,
): Error => ("_tag" in error ? new Error(toForgeReformulateCardErrorMessage(error)) : error);
