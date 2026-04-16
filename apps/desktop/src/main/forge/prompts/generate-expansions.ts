import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";
import { CardQualityPrinciples } from "./card-principles";
import { NormalizedCardArraySchema } from "./normalize";
import { renderBaseUserPrompt } from "./create-cards";

const SourceCardSchema = Schema.Struct({
  question: Schema.String.pipe(Schema.minLength(1)),
  answer: Schema.String.pipe(Schema.minLength(1)),
});

const ExpansionAncestryEntrySchema = Schema.Struct({
  selectedCard: SourceCardSchema,
  siblingCards: NormalizedCardArraySchema,
  instruction: Schema.optional(Schema.String),
});

export const GenerateExpansionsPromptInputSchema = Schema.Struct({
  contextText: Schema.String.pipe(Schema.minLength(1)),
  topic: Schema.String.pipe(Schema.minLength(1)),
  ancestryChain: Schema.Array(ExpansionAncestryEntrySchema).pipe(
    Schema.minItems(1),
  ),
  instruction: Schema.optional(Schema.String),
});
export type GenerateExpansionsPromptInput =
  typeof GenerateExpansionsPromptInputSchema.Type;

export const GenerateExpansionsPromptOutputSchema = Schema.Struct({
  cards: NormalizedCardArraySchema,
});
export type GenerateExpansionsPromptOutput =
  typeof GenerateExpansionsPromptOutputSchema.Type;

const renderGoDeeperPrompt = (input: {
  readonly selectedCard: { readonly question: string; readonly answer: string };
  readonly instruction: string | undefined;
}): string => {
  const trimmedInstruction = input.instruction?.trim();

  const cardHeader = `Go deeper on this card.

Question: ${input.selectedCard.question}
Answer: ${input.selectedCard.answer}`;

  const contextIndependence = `<context_independence>
Each card is context-independent. Every card will be encountered in isolation months or years after creation, interleaved with thousands of other cards on unrelated subjects. The learner will have no memory of what topic generated the card or what other cards accompanied it. This means every question must satisfy the full context-independence principles even when this produces apparent redundancy across cards in the same batch. If five cards about the same topic all need to specify "Soviet military advisers in 1920s China," then all five specify it. Never use shorthand, anaphora, or abbreviated references that only make sense if the learner has just seen another card from the same generation batch. Treat each card as if it is the only card that will ever exist on this topic.

Per-card context audit before finalizing: For each card, independently verify: Could a learner who has never seen the source text, the synthesis topic, or any other card in this batch understand exactly what the question is asking and verify whether their answer is correct? If the question contains any pronoun, demonstrative ("this policy," "the reform"), or entity reference that would be ambiguous without the other cards or the topic statement as context, expand it to its full specific form.

Context-stripping failure example:
Topic: how the Erie Canal's completion in 1825 undercut New England farming.

BAD — Q: "Why couldn't local farmers compete after the canal opened?" / A: "Cheaper Midwestern grain flooded Eastern markets."
GOOD — Q: "Why did the completion of the Erie Canal in 1825 undermine the economic viability of farming in New England?" / A: "Cheaper Midwestern grain reached Eastern seaboard markets, undercutting New England farmers on price."
</context_independence>`;

  const synthesisStrategies = `<generation_strategy>
Approach the topic from every distinct angle of attack you can identify: different entry points into the same causal chain, questions that test the same relationship but from opposite directions (cause→effect vs. "what caused this effect?"), cards that test intermediate steps independently, cards that test boundary conditions or counterfactuals ("why didn't X lead to Y instead?"), and cards that vary in difficulty. Not all of these will be excellent. The goal is to produce a large enough set that the best 2-3 cards can be selected by the learner during review. A mediocre card that was filtered out costs nothing; an excellent card that was never generated is a permanent loss.

Strategies for generating multiple distinct cards from one topic:
Reverse the direction: If the topic describes A causing B, generate one card asking how A led to B and another asking what caused B (with A as the answer).
Isolate intermediate steps: If the causal chain is A→B→C, generate cards for A→B, B→C, and A→C separately.
Test the counterfactual: Ask why the obvious alternative didn't happen, or what would have been different without a specific factor.
Test the preconditions: Ask what conditions had to be in place for the relationship to hold.
Vary the specificity: Generate one card that asks about the broad mechanism and another that asks about a specific instance or manifestation of it.
Test from the constraint side: If X enabled Y, also ask what constraint was removed or what bottleneck was bypassed.
Each card must still test a distinct relationship — the goal is multiple angles on the topic, not multiple phrasings of the same question.
</generation_strategy>`;

  if (!trimmedInstruction) {
    return `${cardHeader}

${synthesisStrategies}

${contextIndependence}`;
  }

  return `${cardHeader}

<user_instruction>
THE FOLLOWING INSTRUCTION OVERRIDES THE DEFAULT GENERATION STRATEGY. Read it first. Determine what kind of cards the user wants. Then generate exactly that.

${trimmedInstruction}

Classify this instruction:
(a) Factual/foundational — definitions, identifications, discrete facts. If so: generate straightforward recall cards. Do NOT apply synthesis strategies.
(b) Synthesis from a different angle — same relationships, new perspectives. If so: use the synthesis strategies below but reframe them through the lens of this instruction.
(c) A specific constraint or transformation. If so: apply it directly.

If the instruction requests factual cards, the synthesis strategies section below is irrelevant — skip it entirely.
</user_instruction>

${synthesisStrategies}

${contextIndependence}

<reminder>
Your primary obligation is to the user instruction above, not to the default synthesis strategies. If they conflict, the user instruction wins unconditionally.
</reminder>`;
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

export const GenerateExpansionsPromptSpec: PromptSpec<
  GenerateExpansionsPromptInput,
  GenerateExpansionsPromptOutput
> = {
  promptId: "forge/generate-expansions",
  displayName: "Expansions",
  version: "1",
  inputSchema: GenerateExpansionsPromptInputSchema,
  outputSchema: GenerateExpansionsPromptOutputSchema,
  defaults: {
    temperature: 1.0,
  },
  render: (input, context) => {
    const messages = [
      {
        role: "user" as const,
        content: renderBaseUserPrompt(input),
      },
      {
        role: "assistant" as const,
        content: JSON.stringify(
          { cards: input.ancestryChain[0]!.siblingCards },
          null,
          2,
        ),
      },
    ];

    for (let index = 1; index < input.ancestryChain.length; index += 1) {
      const previousLevel = input.ancestryChain[index - 1]!;
      const currentLevel = input.ancestryChain[index]!;
      console.log(
        renderGoDeeperPrompt({
          selectedCard: previousLevel.selectedCard,
          instruction: currentLevel.instruction,
        }),
      );
      messages.push({
        role: "user" as const,
        content: renderGoDeeperPrompt({
          selectedCard: previousLevel.selectedCard,
          instruction: currentLevel.instruction,
        }),
      });
      messages.push({
        role: "assistant" as const,
        content: JSON.stringify({ cards: currentLevel.siblingCards }, null, 2),
      });
    }

    messages.push({
      role: "user" as const,
      content: renderGoDeeperPrompt({
        selectedCard:
          input.ancestryChain[input.ancestryChain.length - 1]!.selectedCard,
        instruction: input.instruction,
      }),
    });

    if (!context || context.attempt <= 1) {
      return {
        systemPrompt: CardQualityPrinciples,
        messages,
      };
    }

    return {
      systemPrompt: CardQualityPrinciples,
      messages: [
        ...messages,
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
