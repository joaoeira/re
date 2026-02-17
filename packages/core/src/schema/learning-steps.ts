import { ParseResult, Schema } from "effect";

/**
 * Pattern for non-negative integers
 */
const LEARNING_STEPS_PATTERN = /^(0|[1-9]\d*)$/;

export const LearningStepsFromString: Schema.Schema<number, string> = Schema.transformOrFail(
  Schema.String,
  Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  {
    strict: true,
    decode: (s, _options, ast) => {
      if (!LEARNING_STEPS_PATTERN.test(s)) {
        return ParseResult.fail(
          new ParseResult.Type(ast, s, `LearningSteps must be non-negative integer, got "${s}"`),
        );
      }
      return ParseResult.succeed(parseInt(s, 10));
    },
    encode: (n) => ParseResult.succeed(n.toString()),
  },
);
