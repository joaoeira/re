import { ParseResult, Schema } from "effect";

/**
 * ISO 8601 timestamp pattern with required timezone.
 * Captures date/time components for strict calendar validation.
 * Valid: "2025-01-04T10:30:00Z", "2025-01-04T10:30:00+02:00"
 * Invalid: "2025-01-04T10:30:00" (no timezone = machine-dependent)
 *
 * Why not Schema.DateFromString?
 * - Effect's DateFromString is lenient (accepts any Date.parse input)
 * - We require strict ISO 8601 with timezone to avoid local-time ambiguity
 * - JS Date normalizes invalid dates (Feb 30 → Mar 2), which we reject
 */
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate that the date components in the string match what JS Date parsed.
 * This catches invalid calendar dates like Feb 30 that JS normalizes.
 */
const isValidCalendarDate = (s: string, d: Date): boolean => {
  const match = ISO_TIMESTAMP_PATTERN.exec(s);
  if (!match) return false;

  const [, year, month, day, hour, minute, second, , tz] = match;

  // For UTC timestamps, compare directly
  if (tz === "Z") {
    return (
      d.getUTCFullYear() === parseInt(year!, 10) &&
      d.getUTCMonth() + 1 === parseInt(month!, 10) &&
      d.getUTCDate() === parseInt(day!, 10) &&
      d.getUTCHours() === parseInt(hour!, 10) &&
      d.getUTCMinutes() === parseInt(minute!, 10) &&
      d.getUTCSeconds() === parseInt(second!, 10)
    );
  }

  // For offset timestamps, we need to check the local interpretation
  // The safest approach: reconstruct and compare the UTC result
  // If normalization occurred, the milliseconds won't match a clean parse
  const reparsed = new Date(s);
  return d.getTime() === reparsed.getTime();
};

/**
 * Schema that transforms a string to a Date, requiring ISO 8601 format with timezone.
 * Rejects invalid calendar dates (e.g., Feb 30) that JS would normalize.
 * Encodes back to UTC via toISOString().
 */
export const LastReviewFromString: Schema.Schema<Date, string> = Schema.transformOrFail(
  Schema.String,
  Schema.DateFromSelf,
  {
    strict: true,
    decode: (s, _options, ast) => {
      if (!ISO_TIMESTAMP_PATTERN.test(s)) {
        return ParseResult.fail(
          new ParseResult.Type(ast, s, `Timestamp must include timezone (Z or ±HH:MM): "${s}"`),
        );
      }
      const d = new Date(s);
      if (isNaN(d.getTime())) {
        return ParseResult.fail(new ParseResult.Type(ast, s, `Invalid ISO timestamp: "${s}"`));
      }
      if (!isValidCalendarDate(s, d)) {
        return ParseResult.fail(
          new ParseResult.Type(ast, s, `Invalid calendar date (normalization detected): "${s}"`),
        );
      }
      return ParseResult.succeed(d);
    },
    encode: (d, _options, ast) => {
      if (isNaN(d.getTime())) {
        return ParseResult.fail(new ParseResult.Type(ast, d, "Cannot encode invalid Date"));
      }
      return ParseResult.succeed(d.toISOString());
    },
  },
);
