import { ParseResult, Schema } from "@effect/schema";
import type { ItemId } from "@re/core";

const NonNegativeIntSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
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
