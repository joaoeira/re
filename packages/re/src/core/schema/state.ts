import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import type { State } from "../types.js";

const STATE_PATTERN = /^[0-3]$/;

/**
 * 0=New, 1=Learning, 2=Review, 3=Relearning
 */
export const StateFromString: Schema.Codec<State, string, never, never> = Schema.String.pipe(
  Schema.decodeTo(Schema.Literals([0, 1, 2, 3]), {
    decode: SchemaGetter.transformOrFail((s, options) => {
      if (!STATE_PATTERN.test(s)) {
        return Effect.fail(
          new SchemaIssue.InvalidValue({ message: `State must be 0-3, got "${s}"` }, s, options),
        );
      }
      return Effect.succeed(parseInt(s, 10) as State);
    }),
    encode: SchemaGetter.transform((n) => n.toString()),
  }),
);

export const StateSchema = Schema.toType(StateFromString);
