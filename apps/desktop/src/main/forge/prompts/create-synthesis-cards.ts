import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";
import { CardQualityPrinciples } from "./card-principles";
import { NormalizedCardArraySchema } from "./normalize";

export const CreateSynthesisCardsPromptInputSchema = Schema.Struct({
  contextText: Schema.String.pipe(Schema.minLength(1)),
  topic: Schema.String.pipe(Schema.minLength(1)),
  instruction: Schema.optional(Schema.String),
});
export type CreateSynthesisCardsPromptInput = typeof CreateSynthesisCardsPromptInputSchema.Type;

export const CreateSynthesisCardsPromptOutputSchema = Schema.Struct({
  cards: NormalizedCardArraySchema,
});
export type CreateSynthesisCardsPromptOutput = typeof CreateSynthesisCardsPromptOutputSchema.Type;

const renderInstructionBlock = (instruction: string | undefined): string => {
  const trimmedInstruction = instruction?.trim();
  if (!trimmedInstruction) {
    return "No additional instruction was provided.";
  }

  return `Additional instruction:\n${trimmedInstruction}`;
};

const renderBaseUserPrompt = (input: CreateSynthesisCardsPromptInput): string => {
  return `
    Do not include any explanation, markdown code blocks, or other text. Return only the JSON object.

    You are generating flashcards for a synthesis topic derived from the full source. These cards should test cross-cutting understanding rather than isolated local details.

    Important instructions that must be followed strictly:

    - Use the full source context, not just one local passage.
    - Focus on relationships, contrasts, causal chains, evolutions, and unifying patterns supported by multiple parts of the source.
    - Keep every card directly grounded in the source. Do not invent interpretations beyond what the source supports.
    - Make every card self-contained.
    - Keep answers short, direct, and specific.
    - Avoid redundant cards that simply restate local facts without testing the synthesis idea.

    ---
    Source text:
    ${input.contextText}

    ---

    Synthesis topic:
    ${input.topic}

    ---

    Use the source text to create flashcards specifically and exclusively about the synthesis topic above.

    Return JSON with the exact shape:
    {
      "cards": [
        {
          "question": "Question text here",
          "answer": "Answer text here"
        }
      ]
    }

    ${renderInstructionBlock(input.instruction)}
  `;
};

const renderRepairInstruction = (context: PromptAttemptContext): string => {
  const errorInstruction =
    context.previousErrorTag === "PromptOutputValidationError"
      ? "Your previous JSON response did not match the required schema."
      : "Your previous response was not valid JSON.";

  return [
    errorInstruction,
    'Return ONLY JSON with the exact shape: {"cards":[{"question": string, "answer": string}]}.',
    "Do not include prose, markdown, explanations, or code fences.",
  ].join("\n");
};

export const CreateSynthesisCardsPromptSpec: PromptSpec<
  CreateSynthesisCardsPromptInput,
  CreateSynthesisCardsPromptOutput
> = {
  promptId: "forge/create-synthesis-cards",
  version: "1",
  inputSchema: CreateSynthesisCardsPromptInputSchema,
  outputSchema: CreateSynthesisCardsPromptOutputSchema,
  defaults: {
    model: "gemini:gemini-3-flash-preview",
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
  normalize: (output) => ({
    cards: output.cards,
  }),
};
