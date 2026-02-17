import { ParseResult, Schema } from "effect";
import type { State } from "../types";

const STATE_PATTERN = /^[0-3]$/;

/**
 * 0=New, 1=Learning, 2=Review, 3=Relearning
 */
export const StateFromString: Schema.Schema<State, string> = Schema.transformOrFail(
  Schema.String,
  Schema.Literal(0, 1, 2, 3),
  {
    strict: true,
    decode: (s, _options, ast) => {
      if (!STATE_PATTERN.test(s)) {
        return ParseResult.fail(new ParseResult.Type(ast, s, `State must be 0-3, got "${s}"`));
      }
      return ParseResult.succeed(parseInt(s, 10) as State);
    },
    encode: (n) => ParseResult.succeed(n.toString()),
  },
);

export const StateSchema = Schema.typeSchema(StateFromString);
