import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";

import { CardQualityPrinciples } from "./card-principles";

export const CreateCardsPromptInputSchema = Schema.Struct({
  chunkText: Schema.String.pipe(Schema.minLength(1)),
  topic: Schema.String.pipe(Schema.minLength(1)),
  instruction: Schema.optional(Schema.String),
});
export type CreateCardsPromptInput = typeof CreateCardsPromptInputSchema.Type;

const RawCardSchema = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
});

type RawCard = typeof RawCardSchema.Type;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeCards = (cards: ReadonlyArray<RawCard>): ReadonlyArray<RawCard> => {
  const normalizedCards: RawCard[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const question = collapseWhitespace(card.question);
    const answer = collapseWhitespace(card.answer);
    if (question.length === 0 || answer.length === 0) {
      continue;
    }

    const dedupeKey = `${question}\u0000${answer}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalizedCards.push({ question, answer });
  }

  return normalizedCards;
};

const NormalizedCardArraySchema = Schema.transform(
  Schema.Array(RawCardSchema),
  Schema.Array(RawCardSchema),
  {
    strict: true,
    decode: (cards) => normalizeCards(cards),
    encode: (cards) => cards,
  },
);

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

  ---
  Source text:

  ${input.chunkText}

  ----

  Create flashcards specifically and exclusively about the following topic:
  ${input.topic}

  ----

I want you to use the contents of the text to create flashcards that follow the principles of effective flashcards to create as many flashcards about the statement I will give you. It is imperative that the cards be about the statement you have been given.

Provide your response in JSON format with the following structure:
{
  "cards": [
    {
      "question": "Question text here",
      "answer": "Answer text here",
    },
    // ... more cards
    ]
}

    Do not include any explanation, markdown code blocks, or other text. Return only the JSON object.
    ---

    Important instructions that should be followed strictly:

    - Each flashcard must be fully self-contained. This means that every question should provide all necessary context within itself, without relying on information from other flashcards. Questions should include explicit references to the relevant event, time period, and any necessary background information to ensure that the user can understand the statement without additional context. Make as few make assumptions about the student's prior knowledge of the statement or related events, though you can expect him to have some base knowledge on the statement.

    - Each flashcard should be independent of the remaining in the way they are phrased.

    - The most important thing is that the answer be short, clear, and direct.  It is preferable to create many small cards than try to create a few heavy and overloaded cards with long answers. Note that you do not have to follow the specific wording of the statement, the statement is what I want you to create cards about.

    - Ensure each answer is no longer than two sentences, preferably a single sentence, and conveys the key information succinctly. Try to limit each answer to 15 words or fewer and focus on the essential facts required to answer the question.

    - Exclude any broader discussions or unrelated concepts. Focus on one key fact or concept per flashcard, with answers being concise and limited to two sentences maximum.

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
