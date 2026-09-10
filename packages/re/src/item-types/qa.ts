import { Data, Effect, Schema } from "effect";
import {
  type CardSpec,
  type Grade,
  type ItemType,
  ContentParseError,
  manualCardSpec,
} from "../core/index.js";

export const QAContent = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
});

export type QAContent = typeof QAContent.Type;

const SEPARATOR = "\n---\n";

const QA = "qa";

export class QAComposeError extends Data.TaggedError("QAComposeError")<{
  readonly field: "question" | "answer";
  readonly message: string;
}> {}

/** Compose canonical Q&A content, normalizing CRLF to LF and trimming both fields. */
export const composeQA: (
  question: string,
  answer: string,
) => Effect.Effect<string, QAComposeError> = Effect.fn("composeQA")(function* (question, answer) {
  const normalizedQuestion = question.replace(/\r\n/g, "\n").trim();
  const normalizedAnswer = answer.replace(/\r\n/g, "\n").trim();

  if (!normalizedQuestion) {
    return yield* new QAComposeError({ field: "question", message: "Enter a question." });
  }

  if (!normalizedAnswer) {
    return yield* new QAComposeError({ field: "answer", message: "Enter an answer." });
  }

  if (normalizedQuestion.split("\n").includes("---")) {
    return yield* new QAComposeError({
      field: "question",
      message: "A question cannot contain a line consisting only of ---.",
    });
  }

  return `${normalizedQuestion}${SEPARATOR}${normalizedAnswer}`;
});

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
    manualCardSpec(content.question, content.answer, QA, "main"),
  ],
};
