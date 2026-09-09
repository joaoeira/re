import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import type { NumericField } from "../types.js";

/**
 * Matches: "0", "5", "5.2", "5.20", "0.123"
 * Rejects: "5.2x", "Infinity", "-1", "1e-7", ".5", "5."
 */
const NUMERIC_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Schema that transforms a string to a NumericField, preserving the original
 * string representation for byte-perfect round-trip serialization.
 *
 * The decimal-only grammar and finite-value check enforce the stored format.
 * Keeping raw text distinguishes representations such as "5.20" and "5.2".
 */
export const NumericFieldFromString: Schema.Codec<NumericField, string, never, never> =
  Schema.String.pipe(
    Schema.decodeTo(
      Schema.Struct({
        value: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
        raw: Schema.String,
      }),
      {
        decode: SchemaGetter.transformOrFail((raw, options) => {
          if (!NUMERIC_PATTERN.test(raw)) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: `Invalid numeric format: "${raw}"` },
                raw,
                options,
              ),
            );
          }
          const value = parseFloat(raw);
          if (!Number.isFinite(value)) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: `Numeric value out of range: "${raw}"` },
                raw,
                options,
              ),
            );
          }
          return Effect.succeed({ value, raw });
        }),
        encode: SchemaGetter.transform((field) => field.raw),
      },
    ),
  );

/**
 * Schema for the type side only (after parsing).
 * Use this when you need to validate a NumericField that's already been parsed.
 */
export const NumericFieldSchema = Schema.toType(NumericFieldFromString);
