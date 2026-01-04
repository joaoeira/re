import { Data } from "effect";

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly source: string;
}> {}

export class InvalidMetadataFormat extends Data.TaggedError(
  "InvalidMetadataFormat"
)<{
  readonly line: number;
  readonly raw: string;
  readonly reason: string;
}> {}

export class InvalidFieldValue extends Data.TaggedError("InvalidFieldValue")<{
  readonly line: number;
  readonly field: string;
  readonly value: string;
  readonly expected: string;
}> {}

export type MetadataParseError =
  | ParseError
  | InvalidMetadataFormat
  | InvalidFieldValue;
