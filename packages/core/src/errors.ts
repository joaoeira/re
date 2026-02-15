import * as S from "@effect/schema/Schema";

export class ParseError extends S.TaggedError<ParseError>("@re/core/ParseError")(
  "ParseError",
  {
    line: S.Number,
    column: S.Number,
    message: S.String,
    source: S.String,
  },
) {}

export class InvalidMetadataFormat extends S.TaggedError<InvalidMetadataFormat>(
  "@re/core/InvalidMetadataFormat",
)("InvalidMetadataFormat", {
  line: S.Number,
  raw: S.String,
  reason: S.String,
}) {}

export class InvalidFieldValue extends S.TaggedError<InvalidFieldValue>(
  "@re/core/InvalidFieldValue",
)("InvalidFieldValue", {
  line: S.Number,
  field: S.String,
  value: S.String,
  expected: S.String,
}) {}

export const MetadataParseErrorSchema = S.Union(
  ParseError,
  InvalidMetadataFormat,
  InvalidFieldValue,
);

export type MetadataParseError = S.Schema.Type<typeof MetadataParseErrorSchema>;
