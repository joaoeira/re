import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";

import { CardQualityPrinciples } from "./card-principles";
import { NormalizedCardArraySchema } from "./normalize";

export const CreateCardsPromptInputSchema = Schema.Struct({
  contextText: Schema.String.pipe(Schema.minLength(1)),
  topic: Schema.String.pipe(Schema.minLength(1)),
  instruction: Schema.optional(Schema.String),
  angles: Schema.optional(
    Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  ),
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

export const renderBaseUserPrompt = (input: CreateCardsPromptInput): string => {
  return `

    Do not include any explanation, markdown code blocks, or other text. Return only the JSON object.

    Important instructions that must be followed strictly:

    - Before generating any flashcards, decompose the source text into atomic claims—individual facts, definitions, causal links, or relations that each stand alone as a single testable piece of knowledge. For example, "Pasteur developed the rabies vaccine in 1885 using a laboratory-attenuated virus" contains three atomic claims: who developed it, the date, and the method. Each should produce its own card. A claim can also be argumentative rather than factual: "Hobson argued that imperialism was driven by surplus capital seeking investment outlets" is itself one atomic claim (Hobson's thesis), distinct from claims about who Hobson was or when he wrote. Generate cards from these decomposed claims, not from the original text directly.

    - Create flashcards only for claims that are clearly supported by the source text. Do not infer, elaborate, or speculate beyond what the source provides. You may, however, draw contextual detail from anywhere in the source passage to make a card self-contained—for example, pulling a date from earlier in the passage into a card whose core claim appears later.

    - The angles provided are hard constraints, not soft hints. Restrict card generation to atomic claims that fall within the scope of at least one angle. Claims present in the source and relevant to the topic but outside every angle's scope must be silently dropped. If the intersection of topic, angles, and source produces no atomic claims worth testing, return an empty card array—do not fabricate filler cards to meet an implied quota.

    - Generate exactly one flashcard per atomic claim. A card may link two facts when one is the natural framing for the other (e.g., asking what method Pasteur used inherently identifies Pasteur), but if a card requires a compound answer with multiple independent pieces of information, split it. When in doubt, split.

    - Every flashcard must be fully self-contained. Each question should include the specific event, person, period, or context needed to understand what is being asked, without relying on any other card or on memory of the topic/angle labels.

    - The answer must be short, clear, and direct—no longer than two sentences, preferably one, ideally 15 words or fewer. Focus on one key fact, definition, contrast, cause, or outcome.

    - Prefer varied question forms. Alongside "What/when/who/how" questions, use forms like "Why did X...", "Under what condition...", "What distinguishes X from Y...", and cause/consequence framings where the material supports them. Avoid a uniform stream of identical question shapes.

    - Avoid vague or essay-like prompts. Do not ask for the "significance" or "importance" of something unless the answer space is tightly constrained by the question. "Why did the Peace of Augsburg fail to prevent later religious conflict?" is acceptable if the source gives a specific answer; "What was the significance of the Peace of Augsburg?" is not.

    - Produce a concise set of high-value, non-redundant flashcards. Quality and focus over quantity. Two excellent cards are better than five mediocre ones.

---
      Source text:
      ${input.contextText}

      ---

      Topic:
      ${input.topic}

      ---

${
  input.angles && input.angles.length > 0
    ? `      Angles:\n      - ${input.angles.join("\n      - ")}\n\n      ---\n\n`
    : ""
}
      Your task: using the source text, generate flashcards for atomic claims that fall within the intersection of the topic and any of the angles. The angles collectively narrow the topic to specific dimensions; only claims on at least one of those dimensions should produce cards.

      Before writing any cards, silently:
      1. Identify which parts of the source passage are relevant to the topic.
      2. For each angle, identify which claims within those parts fall in the angle's scope.
      3. Decompose those in-scope claims into atomic testable units, deduplicating any claim that falls under more than one angle.
      4. Generate one card per atomic unit.

      Do not return the intermediate analysis. Return only the final flashcards.

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

export const CreateCardsPromptSpec: PromptSpec<
  CreateCardsPromptInput,
  CreateCardsPromptOutput
> = {
  promptId: "forge/create-cards",
  displayName: "Card generation",
  version: "1",
  inputSchema: CreateCardsPromptInputSchema,
  outputSchema: CreateCardsPromptOutputSchema,
  defaults: {
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
