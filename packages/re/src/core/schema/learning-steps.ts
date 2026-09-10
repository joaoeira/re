import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";

/**
 * Pattern for non-negative integers
 */
const LEARNING_STEPS_PATTERN = /^(0|[1-9]\d*)$/;

export const LearningStepsFromString: Schema.Codec<number, string, never, never> =
  Schema.String.pipe(
    Schema.decodeTo(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), {
      decode: SchemaGetter.transformOrFail((s, options) => {
        if (!LEARNING_STEPS_PATTERN.test(s)) {
          return Effect.fail(
            new SchemaIssue.InvalidValue(
              { message: `LearningSteps must be non-negative integer, got "${s}"` },
              s,
              options,
            ),
          );
        }

        return Effect.succeed(parseInt(s, 10));
      }),
      encode: SchemaGetter.transform((n) => n.toString()),
    }),
  );
