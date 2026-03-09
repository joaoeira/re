import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";
import { CardQualityPrinciples } from "./card-principles";
import { NormalizedCardSchema } from "./normalize";

const SourceCardSchema = Schema.Struct({
  question: Schema.String.pipe(Schema.minLength(1)),
  answer: Schema.String.pipe(Schema.minLength(1)),
});

export const ReformulateCardPromptInputSchema = Schema.Struct({
  contextText: Schema.String.pipe(Schema.minLength(1)),
  source: SourceCardSchema,
});
export type ReformulateCardPromptInput = typeof ReformulateCardPromptInputSchema.Type;

export const ReformulateCardPromptOutputSchema = NormalizedCardSchema;
export type ReformulateCardPromptOutput = typeof ReformulateCardPromptOutputSchema.Type;

const renderBaseUserPrompt = (input: ReformulateCardPromptInput): string => `
Rewrite this flashcard for maximum review value.

Rules:
- Compress aggressively, but do not lose the core historical/conceptual point.
- Do not introduce information not supported by the source.
- Make the card self-contained enough to be understandable after a long delay.
- Include specific actors, dates, or contrasts only when they are necessary for recall.
- Avoid redundancy, filler, and vague pronouns.
- The answer should usually be one sentence or sentence fragment.
- Do not explain your edits.
- If the original wording is already best, keep it.

Desired human-readable form:
Q: ...
A: ...

For this application, return the reformulated card as JSON with the exact shape:
{
  "question": "<rewritten question>",
  "answer": "<rewritten answer>"
}

Do not include any prose, markdown, code fences, or any keys other than "question" and "answer".

Source:
${input.contextText}

Original card:
Q: ${input.source.question}
A: ${input.source.answer}
`;

const renderRepairInstruction = (context: PromptAttemptContext): string => {
  const errorInstruction =
    context.previousErrorTag === "PromptOutputValidationError"
      ? "Your previous JSON response did not match the required schema."
      : "Your previous response was not valid JSON.";

  return [
    errorInstruction,
    'Return ONLY JSON with the exact shape: {"question": string, "answer": string}.',
    "Do not include prose, markdown, explanations, or code fences.",
  ].join("\n");
};

export const ReformulateCardPromptSpec: PromptSpec<
  ReformulateCardPromptInput,
  ReformulateCardPromptOutput
> = {
  promptId: "forge/reformulate-card",
  version: "1",
  inputSchema: ReformulateCardPromptInputSchema,
  outputSchema: ReformulateCardPromptOutputSchema,
  defaults: {
    model: "openai:gpt-5.4",
    temperature: 1.0,
  },
  render: (input, context) => {
    const baseMessage = {
      role: "user" as const,
      content: renderBaseUserPrompt(input),
    };

    if (!context || context.attempt <= 1) {
      return {
        systemPrompt: CardQualityPrinciples,
        messages: [baseMessage],
      };
    }

    return {
      systemPrompt: CardQualityPrinciples,
      messages: [
        baseMessage,
        {
          role: "assistant" as const,
          content: context.previousRawExcerpt ?? "",
        },
        {
          role: "user" as const,
          content: renderRepairInstruction(context),
        },
      ],
    };
  },
  normalize: (output) => output,
};
