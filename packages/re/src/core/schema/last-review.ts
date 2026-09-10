import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";

/**
 * ISO 8601 timestamp pattern with required timezone.
 * Captures date/time components for strict calendar validation.
 * Valid: "2025-01-04T10:30:00Z", "2025-01-04T10:30:00+02:00"
 * Invalid: "2025-01-04T10:30:00" (no timezone = machine-dependent)
 *
 * Require strict ISO 8601 with timezone to avoid local-time ambiguity.
 * JS Date normalizes invalid dates (Feb 30 → Mar 2), which we reject.
 */
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

  // For offset timestamps, convert the parsed UTC instant back into the original
  // offset-local clock components and compare against the captured input values.
  const offsetMinutes = parseTimezoneOffsetMinutes(tz!);
  const localTimeInOffset = new Date(d.getTime() + offsetMinutes * 60 * 1000);

  return (
    localTimeInOffset.getUTCFullYear() === parseInt(year!, 10) &&
    localTimeInOffset.getUTCMonth() + 1 === parseInt(month!, 10) &&
    localTimeInOffset.getUTCDate() === parseInt(day!, 10) &&
    localTimeInOffset.getUTCHours() === parseInt(hour!, 10) &&
    localTimeInOffset.getUTCMinutes() === parseInt(minute!, 10) &&
    localTimeInOffset.getUTCSeconds() === parseInt(second!, 10)
  );
};

/**
 * Schema that transforms a string to a Date, requiring ISO 8601 format with timezone.
 * Rejects invalid calendar dates (e.g., Feb 30) that JS would normalize.
 * Encodes back to UTC via toISOString().
 */
export const LastReviewFromString: Schema.Codec<Date, string, never, never> = Schema.String.pipe(
  Schema.decodeTo(Schema.Date, {
    decode: SchemaGetter.transformOrFail((s, options) => {
      if (!ISO_TIMESTAMP_PATTERN.test(s)) {
        return Effect.fail(
          new SchemaIssue.InvalidValue(
            { message: `Timestamp must include timezone (Z or ±HH:MM): "${s}"` },
            s,
            options,
          ),
        );
      }

      const d = new Date(s);

      if (isNaN(d.getTime())) {
        return Effect.fail(
          new SchemaIssue.InvalidValue({ message: `Invalid ISO timestamp: "${s}"` }, s, options),
        );
      }

      if (!isValidCalendarDate(s, d)) {
        return Effect.fail(
          new SchemaIssue.InvalidValue(
            { message: `Invalid calendar date (normalization detected): "${s}"` },
            s,
            options,
          ),
        );
      }

      return Effect.succeed(d);
    }),
    encode: SchemaGetter.transform((d) => d.toISOString()),
  }),
);
