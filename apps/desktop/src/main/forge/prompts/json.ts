import { Schema } from "@effect/schema";
import { Effect } from "effect";

import { toErrorMessage } from "@main/utils/format";

import { PromptOutputParseError, PromptOutputValidationError } from "./errors";

const RAW_EXCERPT_MAX_CHARS = 500;

const toRawExcerpt = (rawText: string): string => rawText.slice(0, RAW_EXCERPT_MAX_CHARS);

const classifyJsonDecode = <A>(
  schema: Schema.Schema<A>,
  jsonText: string,
  promptId: string,
  rawText: string,
): Effect.Effect<A, PromptOutputParseError | PromptOutputValidationError> =>
  Effect.try({
    try: () => JSON.parse(jsonText),
    catch: (error) =>
      new PromptOutputParseError({
        promptId,
        message: `Model output is not valid JSON: ${toErrorMessage(error)}`,
        rawExcerpt: toRawExcerpt(rawText),
      }),
  }).pipe(
    Effect.flatMap((parsed) =>
      Schema.decodeUnknown(schema)(parsed).pipe(
        Effect.mapError(
          (error) =>
            new PromptOutputValidationError({
              promptId,
              message: `Model output failed schema validation: ${toErrorMessage(error)}`,
              rawExcerpt: toRawExcerpt(rawText),
            }),
        ),
      ),
    ),
  );

const extractFirstBalancedJsonObject = (input: string): string | null => {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === undefined) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;

      if (depth === 0 && startIndex >= 0) {
        return input.slice(startIndex, index + 1);
      }
    }
  }

  return null;
};

export const decodeJsonToSchema = <A>(
  schema: Schema.Schema<A>,
  rawText: string,
  promptId: string,
): Effect.Effect<A, PromptOutputParseError | PromptOutputValidationError> => {
  const trimmed = rawText.trim();
  return classifyJsonDecode(schema, trimmed, promptId, rawText).pipe(
    Effect.catchTag("PromptOutputParseError", (strictParseError) => {
      const extractedObject = extractFirstBalancedJsonObject(trimmed);

      if (extractedObject === null || extractedObject === trimmed) {
        return Effect.fail(strictParseError);
      }

      return classifyJsonDecode(schema, extractedObject, promptId, rawText);
    }),
  );
};
