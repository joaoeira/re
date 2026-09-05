import { Effect, Schema } from "effect";
import {
  type CardSpec,
  type Grade,
  type ItemType,
  ContentParseError,
  manualCardSpec,
} from "@re/core";

export const QAContent = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
});

export type QAContent = typeof QAContent.Type;

const SEPARATOR = "\n---\n";
const QA = "qa";

/**
 * Canonical syntax:
 * ```
 * Question line(s)
 * ---
 * Answer line(s)
 * ```
 */
export const QAType: ItemType<QAContent, Grade, never> = {
  name: QA,

  parse: (content: string) => {
    const separatorIndex = content.indexOf(SEPARATOR);

    if (separatorIndex === -1) {
      return Effect.fail(
        new ContentParseError({
          type: QA,
          message: "Missing '---' separator between question and answer",
          raw: content,
        }),
      );
    }

    const question = content.slice(0, separatorIndex).trim();
    const answer = content.slice(separatorIndex + SEPARATOR.length).trim();

    if (question.length === 0) {
      return Effect.fail(
        new ContentParseError({
          type: QA,
          message: "Question cannot be empty",
          raw: content,
        }),
      );
    }

    if (answer.length === 0) {
      return Effect.fail(
        new ContentParseError({
          type: QA,
          message: "Answer cannot be empty",
          raw: content,
        }),
      );
    }

    return Effect.succeed({ question, answer });
  },

  cards: (content: QAContent): ReadonlyArray<CardSpec<Grade, never>> => [
    manualCardSpec(content.question, content.answer, QA),
  ],
};
