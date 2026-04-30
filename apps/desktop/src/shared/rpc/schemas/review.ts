import { ParseResult, Schema } from "@effect/schema";
import type { ItemId } from "@re/core";
import type { QAContent as QaContent } from "@re/types";

import { ModelIdSchema } from "./ai";

const NonNegativeIntSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
const PositiveIntSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
const ItemIdSchema = Schema.String.pipe(
  Schema.nonEmptyString(),
  Schema.brand("ItemId"),
) as Schema.Schema<ItemId, string>;

const NumericFieldWireSchema = Schema.Struct({
  value: Schema.Number.pipe(Schema.nonNegative()),
  raw: Schema.String,
});

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const parseTimezoneOffsetMinutes = (timezone: string): number => {
  if (timezone === "Z") {
    return 0;
  }

  const sign = timezone.startsWith("-") ? -1 : 1;
  const hours = parseInt(timezone.slice(1, 3), 10);
  const minutes = parseInt(timezone.slice(4, 6), 10);
  return sign * (hours * 60 + minutes);
};

const isValidCalendarDate = (value: string, date: Date): boolean => {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const [, year, month, day, hour, minute, second, , timezone] = match;
  if (timezone === "Z") {
    return (
      date.getUTCFullYear() === parseInt(year!, 10) &&
      date.getUTCMonth() + 1 === parseInt(month!, 10) &&
      date.getUTCDate() === parseInt(day!, 10) &&
      date.getUTCHours() === parseInt(hour!, 10) &&
      date.getUTCMinutes() === parseInt(minute!, 10) &&
      date.getUTCSeconds() === parseInt(second!, 10)
    );
  }

  const offsetMinutes = parseTimezoneOffsetMinutes(timezone!);
  const localTimeInOffset = new Date(date.getTime() + offsetMinutes * 60 * 1000);

  return (
    localTimeInOffset.getUTCFullYear() === parseInt(year!, 10) &&
    localTimeInOffset.getUTCMonth() + 1 === parseInt(month!, 10) &&
    localTimeInOffset.getUTCDate() === parseInt(day!, 10) &&
    localTimeInOffset.getUTCHours() === parseInt(hour!, 10) &&
    localTimeInOffset.getUTCMinutes() === parseInt(minute!, 10) &&
    localTimeInOffset.getUTCSeconds() === parseInt(second!, 10)
  );
};

const StrictDateFromStringSchema: Schema.Schema<Date, string> = Schema.transformOrFail(
  Schema.String,
  Schema.DateFromSelf,
  {
    strict: true,
    decode: (value, _options, ast) => {
      if (!ISO_TIMESTAMP_PATTERN.test(value)) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            value,
            `Timestamp must include timezone (Z or ±HH:MM): "${value}"`,
          ),
        );
      }

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return ParseResult.fail(
          new ParseResult.Type(ast, value, `Invalid ISO timestamp: "${value}"`),
        );
      }

      if (!isValidCalendarDate(value, date)) {
        return ParseResult.fail(
          new ParseResult.Type(
            ast,
            value,
            `Invalid calendar date (normalization detected): "${value}"`,
          ),
        );
      }

      return ParseResult.succeed(date);
    },
    encode: (value, _options, ast) => {
      if (Number.isNaN(value.getTime())) {
        return ParseResult.fail(new ParseResult.Type(ast, value, "Cannot encode invalid Date"));
      }

      return ParseResult.succeed(value.toISOString());
    },
  },
);

const NullableDateFromStringSchema = Schema.Union(StrictDateFromStringSchema, Schema.Null);

export const LightQueueItemSchema = Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  cardIndex: NonNegativeIntSchema,
  deckName: Schema.String,
});

export type LightQueueItem = typeof LightQueueItemSchema.Type;

export const ReviewCardRefSchema = Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  cardIndex: NonNegativeIntSchema,
});

export type ReviewCardRef = typeof ReviewCardRefSchema.Type;

export const FSRSGradeSchema = Schema.Literal(0, 1, 2, 3);

export type FSRSGrade = typeof FSRSGradeSchema.Type;

export const SerializedItemMetadataSchema = Schema.Struct({
  id: ItemIdSchema,
  stability: NumericFieldWireSchema,
  difficulty: NumericFieldWireSchema,
  state: Schema.Literal(0, 1, 2, 3),
  learningSteps: NonNegativeIntSchema,
  lastReview: NullableDateFromStringSchema,
  due: NullableDateFromStringSchema,
});

export type SerializedItemMetadata = typeof SerializedItemMetadataSchema.Type;

export class CardContentNotFoundError extends Schema.TaggedError<CardContentNotFoundError>(
  "@re/desktop/rpc/CardContentNotFoundError",
)("not_found", {
  message: Schema.String,
}) {}

export class CardContentParseError extends Schema.TaggedError<CardContentParseError>(
  "@re/desktop/rpc/CardContentParseError",
)("parse_error", {
  message: Schema.String,
}) {}

export class CardContentReadError extends Schema.TaggedError<CardContentReadError>(
  "@re/desktop/rpc/CardContentReadError",
)("read_error", {
  message: Schema.String,
}) {}

export class CardContentIndexOutOfBoundsError extends Schema.TaggedError<CardContentIndexOutOfBoundsError>(
  "@re/desktop/rpc/CardContentIndexOutOfBoundsError",
)("card_index_out_of_bounds", {
  cardIndex: NonNegativeIntSchema,
  availableCards: NonNegativeIntSchema,
}) {}

export const CardContentErrorSchema = Schema.Union(
  CardContentNotFoundError,
  CardContentReadError,
  CardContentParseError,
  CardContentIndexOutOfBoundsError,
);

export type CardContentError = typeof CardContentErrorSchema.Type;

export const CardContentResultSchema = Schema.Struct({
  prompt: Schema.String,
  reveal: Schema.String,
  cardType: Schema.Literal("qa", "cloze"),
});

export type CardContentResult = typeof CardContentResultSchema.Type;

const ReviewAssistantQaContentSchema: Schema.Schema<QaContent> = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
});

export const ReviewAssistantQaSourceCardSchema = Schema.Struct({
  cardType: Schema.Literal("qa"),
  content: ReviewAssistantQaContentSchema,
});

export type ReviewAssistantQaSourceCard = typeof ReviewAssistantQaSourceCardSchema.Type;

export class ReviewAssistantUnsupportedCardTypeError extends Schema.TaggedError<ReviewAssistantUnsupportedCardTypeError>(
  "@re/desktop/rpc/ReviewAssistantUnsupportedCardTypeError",
)("assistant_unsupported_card_type", {
  cardType: Schema.String,
  message: Schema.String,
}) {}

export const ReviewAssistantSourceCardResultSchema = Schema.Struct({
  sourceCard: ReviewAssistantQaSourceCardSchema,
});

export type ReviewAssistantSourceCardResult = typeof ReviewAssistantSourceCardResultSchema.Type;

export const ReviewAssistantSourceCardErrorSchema = Schema.Union(
  CardContentErrorSchema,
  ReviewAssistantUnsupportedCardTypeError,
);

export type ReviewAssistantSourceCardError = typeof ReviewAssistantSourceCardErrorSchema.Type;

export const ReviewGeneratePermutationsInputSchema = Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  cardIndex: NonNegativeIntSchema,
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});

export type ReviewGeneratePermutationsInput = typeof ReviewGeneratePermutationsInputSchema.Type;

export const ReviewGeneratedPermutationSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.nonEmptyString()),
  question: Schema.String.pipe(Schema.nonEmptyString()),
  answer: Schema.String.pipe(Schema.nonEmptyString()),
});

export type ReviewGeneratedPermutation = typeof ReviewGeneratedPermutationSchema.Type;

export class ReviewPermutationGenerationError extends Schema.TaggedError<ReviewPermutationGenerationError>(
  "@re/desktop/rpc/ReviewPermutationGenerationError",
)("review_permutation_generation_error", {
  message: Schema.String,
}) {}

export const ReviewGeneratePermutationsResultSchema = Schema.Struct({
  permutations: Schema.Array(ReviewGeneratedPermutationSchema),
});

export type ReviewGeneratePermutationsResult = typeof ReviewGeneratePermutationsResultSchema.Type;

export const ReviewGeneratePermutationsErrorSchema = Schema.Union(
  CardContentErrorSchema,
  ReviewAssistantUnsupportedCardTypeError,
  ReviewPermutationGenerationError,
);

export type ReviewGeneratePermutationsError = typeof ReviewGeneratePermutationsErrorSchema.Type;

export const ReviewSessionOrderSchema = Schema.Literal("default", "due-first", "new-first");

export type ReviewSessionOrder = typeof ReviewSessionOrderSchema.Type;

export const ReviewSessionOptionsSchema = Schema.Struct({
  includeNew: Schema.Boolean,
  includeDue: Schema.Boolean,
  cardLimit: Schema.Union(PositiveIntSchema, Schema.Null),
  order: ReviewSessionOrderSchema,
});

export type ReviewSessionOptions = typeof ReviewSessionOptionsSchema.Type;

export const DEFAULT_REVIEW_SESSION_OPTIONS: ReviewSessionOptions = {
  includeNew: true,
  includeDue: true,
  cardLimit: null,
  order: "default",
};

export type ReviewSessionOptionsSearch = {
  includeNew?: boolean;
  includeDue?: boolean;
  limit?: number;
  order?: ReviewSessionOrder;
};

const parseBooleanSearchValue = (value: unknown): boolean | undefined => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
};

const parsePositiveIntSearchValue = (value: unknown): number | undefined => {
  const numericValue =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isInteger(numericValue) || numericValue <= 0) return undefined;
  return numericValue;
};

const parseReviewSessionOrderSearchValue = (value: unknown): ReviewSessionOrder | undefined => {
  if (value === "default" || value === "due-first" || value === "new-first") {
    return value;
  }
  return undefined;
};

export const isDefaultReviewSessionOptions = (options: ReviewSessionOptions): boolean =>
  options.includeNew === DEFAULT_REVIEW_SESSION_OPTIONS.includeNew &&
  options.includeDue === DEFAULT_REVIEW_SESSION_OPTIONS.includeDue &&
  options.cardLimit === DEFAULT_REVIEW_SESSION_OPTIONS.cardLimit &&
  options.order === DEFAULT_REVIEW_SESSION_OPTIONS.order;

export const decodeReviewSessionOptionsFromSearch = (
  search: Record<string, unknown>,
): ReviewSessionOptions => {
  const parsedIncludeNew = parseBooleanSearchValue(search.includeNew);
  const parsedIncludeDue = parseBooleanSearchValue(search.includeDue);
  let includeNew = parsedIncludeNew ?? DEFAULT_REVIEW_SESSION_OPTIONS.includeNew;
  let includeDue = parsedIncludeDue ?? DEFAULT_REVIEW_SESSION_OPTIONS.includeDue;

  if (!includeNew && !includeDue) {
    includeNew = DEFAULT_REVIEW_SESSION_OPTIONS.includeNew;
    includeDue = DEFAULT_REVIEW_SESSION_OPTIONS.includeDue;
  }

  return {
    includeNew,
    includeDue,
    cardLimit:
      parsePositiveIntSearchValue(search.limit) ?? DEFAULT_REVIEW_SESSION_OPTIONS.cardLimit,
    order: parseReviewSessionOrderSearchValue(search.order) ?? DEFAULT_REVIEW_SESSION_OPTIONS.order,
  };
};

export const encodeReviewSessionOptionsForSearch = (
  options: ReviewSessionOptions,
): ReviewSessionOptionsSearch => {
  const search: ReviewSessionOptionsSearch = {};

  if (options.includeNew !== DEFAULT_REVIEW_SESSION_OPTIONS.includeNew) {
    search.includeNew = options.includeNew;
  }

  if (options.includeDue !== DEFAULT_REVIEW_SESSION_OPTIONS.includeDue) {
    search.includeDue = options.includeDue;
  }

  if (
    options.cardLimit !== DEFAULT_REVIEW_SESSION_OPTIONS.cardLimit &&
    options.cardLimit !== null
  ) {
    search.limit = options.cardLimit;
  }

  if (options.order !== DEFAULT_REVIEW_SESSION_OPTIONS.order) {
    search.order = options.order;
  }

  return search;
};

export const reviewSessionOptionsCacheKey = (options: ReviewSessionOptions): string =>
  isDefaultReviewSessionOptions(options)
    ? "default"
    : [
        `new:${options.includeNew ? "1" : "0"}`,
        `due:${options.includeDue ? "1" : "0"}`,
        `limit:${options.cardLimit ?? "none"}`,
        `order:${options.order}`,
      ].join("|");

export const getReviewSessionCardCount = (
  metrics: { readonly newCount: number; readonly dueCount: number },
  options: ReviewSessionOptions,
): number => {
  const includedCount =
    (options.includeNew ? metrics.newCount : 0) + (options.includeDue ? metrics.dueCount : 0);
  return options.cardLimit === null ? includedCount : Math.min(options.cardLimit, includedCount);
};

export const BuildReviewQueueResultSchema = Schema.Struct({
  items: Schema.Array(LightQueueItemSchema),
  totalNew: Schema.Number.pipe(Schema.nonNegative()),
  totalDue: Schema.Number.pipe(Schema.nonNegative()),
});

export type BuildReviewQueueResult = typeof BuildReviewQueueResultSchema.Type;

export class ReviewOperationError extends Schema.TaggedError<ReviewOperationError>(
  "@re/desktop/rpc/ReviewOperationError",
)("review_operation_error", {
  message: Schema.String,
}) {}

export class UndoConflictError extends Schema.TaggedError<UndoConflictError>(
  "@re/desktop/rpc/UndoConflictError",
)("undo_conflict", {
  deckPath: Schema.String,
  cardId: Schema.String,
  message: Schema.String,
  expectedCurrentCardFingerprint: Schema.String,
  actualCurrentCardFingerprint: Schema.String,
}) {}

export class UndoSafetyUnavailableError extends Schema.TaggedError<UndoSafetyUnavailableError>(
  "@re/desktop/rpc/UndoSafetyUnavailableError",
)("undo_safety_unavailable", {
  message: Schema.String,
}) {}

export const UndoReviewErrorSchema = Schema.Union(
  ReviewOperationError,
  UndoConflictError,
  UndoSafetyUnavailableError,
);

export type UndoReviewError = typeof UndoReviewErrorSchema.Type;

export const ReviewStatsSchema = Schema.Struct({
  total: Schema.Number.pipe(Schema.nonNegative()),
  active: Schema.Number.pipe(Schema.nonNegative()),
  undone: Schema.Number.pipe(Schema.nonNegative()),
});

export type ReviewStats = typeof ReviewStatsSchema.Type;

export const ReviewHistoryEntrySchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int(), Schema.positive()),
  workspaceCanonicalPath: Schema.String,
  reviewedAt: Schema.String,
  deckRelativePath: Schema.String,
  deckPath: Schema.String,
  cardId: Schema.String,
  grade: FSRSGradeSchema,
  previousState: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  nextState: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  previousDue: Schema.Union(Schema.String, Schema.Null),
  nextDue: Schema.Union(Schema.String, Schema.Null),
  previousStability: Schema.Number.pipe(Schema.nonNegative()),
  nextStability: Schema.Number.pipe(Schema.nonNegative()),
  previousDifficulty: Schema.Number.pipe(Schema.nonNegative()),
  nextDifficulty: Schema.Number.pipe(Schema.nonNegative()),
  previousLearningSteps: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  nextLearningSteps: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  undoneAt: Schema.Union(Schema.String, Schema.Null),
});

export type ReviewHistoryEntry = typeof ReviewHistoryEntrySchema.Type;
