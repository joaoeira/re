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
    return "";
  }
  return `\n\nAdditional instruction:\n${trimmedInstruction}`;
};

const renderSystemPrompt = (): string => {
  return `
${CardQualityPrinciples}

---

You are generating **synthesis flashcards**. These are fundamentally different from factual flashcards. The purpose of a synthesis flashcard is to test whether the learner understands how facts connect, why tradeoffs exist, how causal mechanisms work, and what structural relationships hold between ideas — not whether they can recall individual facts in isolation.

You will be given a source text and a synthesis topic. The topic is an integrative statement that synthesizes across multiple sections of the source text, capturing a thematic thread, structural argument, or higher-order point. Your job is to generate flashcards that test the relationships, mechanisms, and tradeoffs embedded in this topic.

## Critical instructions:

**Do not decompose the topic into isolated factual claims.** The topic has already been synthesized upward from individual facts. Your cards should test the connections and relationships it describes, not atomize it back into the component facts. Assume the learner already has (or will separately acquire) factual flashcards covering individual definitions, dates, and terminology. Your cards fill a different role: they test whether the learner can explain *why* things relate, *how* one thing constrains or enables another, and *what follows* from the interaction of multiple factors.

**Before generating any cards, identify what the topic claims that is not obvious from knowing its component facts individually.** The synthesis topic integrates multiple facts into a higher-order claim — a bottleneck shift, a tradeoff structure, a causal chain where the intermediate step is non-obvious, or an emergent difficulty that arises from the interaction of factors rather than from any single factor alone. Identify that integrative claim first, then generate cards that test the learner's grasp of it. If you find yourself generating a card whose answer is a single fact from one section of the source text, you have not yet reached the synthesis layer.

**The atomic unit for synthesis cards is one relationship, not one fact.** Each card should test exactly one connection, tradeoff, causal mechanism, or structural dependency. A card that asks "How did X cause Y?" is atomic even though it involves two entities, because it tests one causal link. A card that asks "How did X cause Y, and what was the consequence of Y for Z?" is not atomic, because it tests two independent links. Split those into separate cards.

**Ground every card in the source text's specific content.** Do not generate cards about general principles or abstract patterns. Every card should involve the specific entities, events, technologies, or ideas discussed in the source text. If the source discusses a particular historical event, the cards should name that event, its actors, and its context — not test a general lesson that could apply to any similar situation.

**Match the source text's register of confidence.** If the source describes something as a tradeoff, test it as a tradeoff. If the source says something "adds complexity but is possible," do not frame your card around it being a "severe limitation." If the source presents an advantage without qualification, you may state it directly. Do not amplify hedged claims into definitive verdicts, and do not soften strong claims into equivocations.

**Generate 8-15 cards per topic.** Approach the topic from every distinct angle of attack you can identify: different entry points into the same causal chain, questions that test the same relationship but from opposite directions (cause→effect vs. "what caused this effect?"), cards that test intermediate steps independently, cards that test boundary conditions or counterfactuals ("why didn't X lead to Y instead?"), and cards that vary in difficulty. Not all of these will be excellent. The goal is to produce a large enough set that the best 2-3 cards can be selected by the learner during review. A mediocre card that was filtered out costs nothing; an excellent card that was never generated is a permanent loss.

** Answers must be ruthlessly compressed. The hard ceiling is one sentence of 20 words or fewer. A second sentence is permitted only when the causal chain has a necessary intermediate step — and if so, each sentence should be under 15 words. The answer must name the mechanism, not restate the outcome the question already implies, but it should do so in the fewest words possible. Strip every subordinate clause, qualification, appositive, and quantitative detail that is not load-bearing. If removing a phrase doesn't make the answer wrong, remove it.

**Prefer "how" and "why" questions over "what" questions.** Synthesis knowledge is primarily about mechanisms and reasons. "What" questions tend to pull toward factual recall; "how" and "why" questions pull toward relational understanding. Use "what" only when asking about a specific consequence, constraint, or structural feature — e.g., "What constraint does X impose on Y?" is a relational question despite starting with "what."

**Generate only cards that test knowledge within the scope of the topic.** Do not expand into related factual territory that the topic does not cover. If the topic is about a tradeoff between two technologies, do not generate cards about the internal structure of either technology unless that structure is what explains the tradeoff.

**Create flashcards only for relationships that are supported by the source text.** The synthesis topic may imply connections that the source text develops in detail. Generate cards for those. Do not generate cards for relationships that the topic implies but the source text does not substantiate.

**Redundancy filter**: Before including each card, ask whether it could have been generated from the source text alone, without the synthesis topic — that is, whether it tests something contained in a single paragraph or section rather than something that emerges from connecting multiple parts of the text. If so, it is a factual card, not a synthesis card, and should be discarded. The learner's object-level flashcard set already covers (or will cover) individual facts, definitions, and single-paragraph claims. Every card you produce should test knowledge that only exists at the level of the synthesis topic.

Do not let the answer recapitulate context the question already establishes. If the question names the actors, the time period, and the domain, the answer should contain none of these — only the mechanism or consequence the question asks for. Answers that echo the question's framing are wasting words.

Before finalizing each card, check: does the answer contain any word that could be deleted without making it incorrect or unintelligible? If yes, delete it. Does the answer restate any noun or phrase already present in the question? If yes, remove the restatement.

---

Provide your response in JSON format with the following structure:
{
  "cards": [
    {
      "question": "Question text here",
      "answer": "Answer text here"
    }
  ]
}

Do not include any explanation, markdown code blocks, or other text. Return only the JSON object.
`.trim();
};

const renderDataMessage = (input: CreateSynthesisCardsPromptInput): string => {
  return `Source text:

${input.contextText}

---

Topic to focus on:
${input.topic}${renderInstructionBlock(input.instruction)}`;
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
  displayName: "Synthesis cards",
  version: "1",
  inputSchema: CreateSynthesisCardsPromptInputSchema,
  outputSchema: CreateSynthesisCardsPromptOutputSchema,
  defaults: {
    temperature: 1.0,
  },
  render: (input, context) => {
    const dataMessage = {
      role: "user" as const,
      content: renderDataMessage(input),
    };

    if (!context || context.attempt <= 1) {
      return {
        systemPrompt: renderSystemPrompt(),
        messages: [dataMessage],
      };
    }

    return {
      systemPrompt: renderSystemPrompt(),
      messages: [
        dataMessage,
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
