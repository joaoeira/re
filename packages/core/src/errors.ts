import { Schema } from "@effect/schema";

export class ParseError extends Schema.TaggedError<ParseError>("@re/core/ParseError")(
  "ParseError",
  {
    line: Schema.Number,
    column: Schema.Number,
    message: Schema.String,
    source: Schema.String,
  },
) {}

export class InvalidMetadataFormat extends Schema.TaggedError<InvalidMetadataFormat>(
  "@re/core/InvalidMetadataFormat",
)("InvalidMetadataFormat", {
  line: Schema.Number,
  raw: Schema.String,
  reason: Schema.String,
}) {}

export class InvalidFieldValue extends Schema.TaggedError<InvalidFieldValue>(
  "@re/core/InvalidFieldValue",
)("InvalidFieldValue", {
  line: Schema.Number,
  field: Schema.String,
  value: Schema.String,
  expected: Schema.String,
}) {}

export const MetadataParseErrorSchema = Schema.Union(
  ParseError,
  InvalidMetadataFormat,
  InvalidFieldValue,
);

export type MetadataParseError = typeof MetadataParseErrorSchema.Type;
