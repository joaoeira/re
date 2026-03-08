import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";

import { CardQualityPrinciples } from "./card-principles";
import { NormalizedCardArraySchema } from "./normalize";

export const CreateCardsPromptInputSchema = Schema.Struct({
  contextText: Schema.String.pipe(Schema.minLength(1)),
  topic: Schema.String.pipe(Schema.minLength(1)),
  instruction: Schema.optional(Schema.String),
});
export type CreateCardsPromptInput = typeof CreateCardsPromptInputSchema.Type;

export const CreateCardsPromptOutputSchema = Schema.Struct({
  cards: NormalizedCardArraySchema,
});
export type CreateCardsPromptOutput = typeof CreateCardsPromptOutputSchema.Type;

const renderInstructionBlock = (instruction: string | undefined): string => {
  const trimmedInstruction = instruction?.trim();
  if (!trimmedInstruction) {
    return "No additional instruction was provided.";
  }

  return `Additional instruction:\n${trimmedInstruction}`;
};

const renderBaseUserPrompt = (input: CreateCardsPromptInput): string => {
  return `


    Do not include any explanation, markdown code blocks, or other text. Return only the JSON object.

 Important instructions that must be followed strictly:

- Before generating any flashcards, decompose the source text into atomic claims—individual facts, definitions, causal links, or relations that each stand alone as a single testable piece of knowledge. For example, "Pasteur developed the rabies vaccine in 1885 using a laboratory-attenuated virus" contains three atomic claims: who developed it, the date, and the method. Each should produce its own card. Generate cards from these decomposed claims, not from the original text directly.

- Create flashcards only for claims that are clearly supported by the source text. Do not infer, elaborate, or add context beyond what the source provides.

- Generate exactly one flashcard per atomic claim. A card may link two facts when one is the natural framing for the other (e.g. asking what method Pasteur used inherently identifies Pasteur), but if a card requires a compound answer with multiple independent pieces of information, it should be split.

- Every flashcard must be fully self-contained. Each question should include the specific event, person, period, or context needed to understand what is being asked, without relying on any other card.

- The answer must be short, clear, and direct—no longer than two sentences, preferably one, ideally 15 words or fewer. Focus on one key fact, definition, contrast, cause, or outcome.

- Avoid vague or essay-like prompts. Do not ask for the "significance" or "importance" of something unless the answer space is tightly constrained by the question.

- Produce a concise set of high-value, non-redundant flashcards. Quality and focus over quantity.

---
      Source text:
      ${input.contextText}

      ---

      Topic:
      ${input.topic}

      ---

      Use the source text to create flashcards specifically and exclusively about the topic above.

      Important: the topic may contain multiple distinct factual or conceptual claims. Before writing any flashcards, silently break the topic down into its atomic, directly testable claims. Then generate flashcards from those atomic claims rather than from the topic sentence as a whole.

      Do not return the claims. Return only the final flashcards.

      Provide your response in JSON format with the following structure:
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

export const CreateCardsPromptSpec: PromptSpec<CreateCardsPromptInput, CreateCardsPromptOutput> = {
  promptId: "forge/create-cards",
  version: "1",
  inputSchema: CreateCardsPromptInputSchema,
  outputSchema: CreateCardsPromptOutputSchema,
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
