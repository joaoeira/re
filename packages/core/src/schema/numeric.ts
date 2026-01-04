import { ParseResult, Schema } from "effect";
import type { NumericField } from "../types";

/**
 * Matches: "0", "5", "5.2", "5.20", "0.123"
 * Rejects: "5.2x", "Infinity", "-1", "1e-7", ".5", "5."
 */
const NUMERIC_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Schema that transforms a string to a NumericField, preserving the original
 * string representation for byte-perfect round-trip serialization.
 *
 * Why not Schema.NumberFromString?
 * - Effect's NumberFromString accepts "Infinity", "NaN", and trailing junk
 * - We need to preserve the original string representation (e.g., "5.20" vs "5.2")
 * - Custom regex ensures strict format: non-negative decimal, no exponent
 */
export const NumericFieldFromString: Schema.Schema<NumericField, string> =
  Schema.transformOrFail(
    Schema.String,
    Schema.Struct({
      value: Schema.Number.pipe(Schema.nonNegative()),
      raw: Schema.String,
    }),
    {
      strict: true,
      decode: (raw, _options, ast) => {
        if (!NUMERIC_PATTERN.test(raw)) {
          return ParseResult.fail(
            new ParseResult.Type(ast, raw, `Invalid numeric format: "${raw}"`)
          );
        }
        const value = parseFloat(raw);
        if (!Number.isFinite(value)) {
          return ParseResult.fail(
            new ParseResult.Type(
              ast,
              raw,
              `Numeric value out of range: "${raw}"`
            )
          );
        }
        return ParseResult.succeed({ value, raw });
      },
      encode: (field) => ParseResult.succeed(field.raw),
    }
  );

/**
 * Schema for the type side only (after parsing).
 * Use this when you need to validate a NumericField that's already been parsed.
 */
export const NumericFieldSchema = Schema.typeSchema(NumericFieldFromString);
