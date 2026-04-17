import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";
import { NormalizedStringArraySchema } from "./normalize";

export const GetAnglesPromptInputSchema = Schema.Struct({
  topic: Schema.String.pipe(Schema.minLength(1)),
  contextText: Schema.String.pipe(Schema.minLength(1)),
});
export type GetAnglesPromptInput = typeof GetAnglesPromptInputSchema.Type;

export const GetAnglesPromptOutputSchema = Schema.Struct({
  angles: NormalizedStringArraySchema.pipe(
    Schema.filter((angles) => angles.length > 0, {
      message: () => ({
        message:
          "Angle list must contain at least one non-empty entry after normalization.",
        override: true,
      }),
    }),
  ),
});
export type GetAnglesPromptOutput = typeof GetAnglesPromptOutputSchema.Type;

export const renderBaseUserPrompt = (input: GetAnglesPromptInput): string => {
  return `
    Source text:
    ${input.contextText}

    ---

    Topic:
    ${input.topic}

    ---

    Provide your response in JSON format with the following structure:
    {
      "angles": [
        "<angle>",
        "<angle>",
        ...
      ]
    }

    Do not include any other text or explanations in your response, just the JSON object, otherwise your response will be rejected.
    Do not wrap it in markdown code blocks, just return the JSON object.
`;
};

const renderSystemPrompt = (): string => {
  return `
  You are analyzing a source passage and one summary statement ("topic") derived from it. Your task is to identify the distinct dimensions along which this topic could be tested as flashcards. These dimensions — called "angles" — will be passed to a separate model that generates the actual cards. Your output is steering input, not final content.

  An angle is a short label naming one testable aspect of the topic. Good angles satisfy all of the following:

  1. **Grounded in the source.** An angle is valid only if the source passage contains enough material to generate a substantive flashcard from it. Do not invent angles the source cannot support, even if they seem pedagogically obvious for this kind of topic.

  2. **Orthogonal to other angles.** Two angles must not produce near-identical cards. "Causes" and "reasons for" are the same angle; drop one. If two candidate angles overlap substantially, either merge them or pick the sharper one.

  3. **Specific enough to steer, open enough to allow variation.** An angle should narrow the card generator's focus without dictating the exact question. "Date" is too narrow (produces only one card). "The topic itself" is too broad (no steering). "Why it settled the war" is right — it pins down the dimension but leaves room for how to test it.

  4. **Labeled concisely.** 2–6 words. Use natural phrases, not sentences. Capitalize like a title but don't end with punctuation. Examples: "Mechanism of inflation", "Consequences for Spain", "Geographic spread", "Counterintuitive aspect".

  5. **Worth testing.** Prefer dimensions a knowledgeable tutor would highlight: underlying mechanisms, consequences, comparisons, key actors, specific dates when they are historically significant, counterintuitive or commonly misunderstood aspects, relationships to other events. Avoid dimensions that produce trivial recall cards unless the fact is genuinely important (a central date, a proper noun that must be remembered).

  Produce between 2 and 6 angles. Err toward fewer, high-quality angles rather than more, marginal ones. If the topic is narrow and the source only supports one or two angles, return that — do not pad. If the topic is broad and the source supports 5–6 genuinely distinct angles, return them all.

  Prefer category-level labels over source-specific references. An angle names a dimension of the topic, not a specific fact from the source. "Economic consequences" is good; "The 1873 banking panic mentioned in paragraph three" is bad. The user will see angle labels disconnected from the source passage — labels must be interpretable without re-reading the source. When an angle would naturally reference a specific event, person, or fact, abstract it to the category: "Triggering event" rather than "The Defenestration of Prague"; "Key theorist" rather than "Hobson's role"; "Structural vulnerability" rather than "Vulnerability of the imperialist system"

  Labels should gesture at the question a card would ask, not merely name an abstract noun phrase. Prefer labels with verbs, wh-words, or directional framings over stacked abstract nouns. "How the theory explains capital flow" communicates a card direction; "Theoretical logic of the doctrine" does not — it only names a region. When writing a label, ask yourself: "Would a reader know what kind of card this would produce without seeing the source?" If not, rewrite.

  Do not include an angle that is just a restatement of the topic itself. Do not include "Overview" or "Summary" as angles.

  ## Input

  You will receive:
  - \`source\`: the passage of text from which the topic was extracted
  - \`topic\`: a single-sentence summary statement derived from that source

  ## Output

  Return a JSON object with this structure:

  {
    "angles": [
      "<angle label>",
      "<angle label>",
      ...
    ]
  }

  Do not include any other text, explanation, or markdown formatting. Just the JSON object.

  ## Examples

  ### Example 1 — broad topic, multiple distinct angles supported

  source: "The Treaty of Westphalia, signed in 1648, ended the Thirty Years' War and the Eighty Years' War. It established the principle that each sovereign state had supreme authority within its territory, free from external interference by other states or by the Pope. This principle, sometimes called Westphalian sovereignty, replaced the earlier hierarchical order in which the Holy Roman Emperor and the Pope claimed universal authority over Christian Europe. The treaty also recognized the independence of the Dutch Republic and the Swiss Confederation, and granted Imperial estates within the Holy Roman Empire the right to conduct their own foreign policy, significantly weakening the Emperor's authority."

  topic: "The Treaty of Westphalia (1648) and the establishment of state sovereignty."

  {
    "angles": [
      "Principle of sovereignty",
      "Break from imperial-papal order",
      "Non-interference doctrine",
      "Weakening of Imperial authority",
      "Recognition of Dutch and Swiss independence"
    ]
  }

  Note: "Date" is not included because 1648 is better folded into whichever angle's card naturally references it. "Conflicts ended" is omitted because the source mentions this only briefly and a card would be thin.

  ### Example 2 — narrow topic, few angles supported

  source: "The Defenestration of Prague, which occurred on May 23, 1618, saw two Imperial Catholic governors and their scribe thrown from a high window of Prague Castle by a group of Protestant nobles. All three men survived the fall. The event is conventionally treated as the immediate trigger of the Thirty Years' War."

  topic: "The Defenestration of Prague (1618) as the trigger of the Thirty Years' War."

  {
    "angles": [
      "The event itself",
      "Why it triggered the war",
      "Date and actors"
    ]
  }

  Note: Only three angles because the source is short and doesn't support more. "Survival of the victims" is a tempting inclusion but would produce a trivia card unlikely to be worth remembering.

  ### Example 3 — pedagogically tempting angle that the source does not support

  source: "Mercantilism dominated European economic thought from the 16th through 18th centuries. Its central tenet held that a nation's wealth was measured by its stock of precious metals, and that national power therefore required a persistent trade surplus to accumulate bullion."

  topic: "Mercantilism as dominant European economic doctrine (16th–18th c.)."

  {
    "angles": [
      "Core tenets",
      "Bullion as measure of wealth",
      "Trade surplus logic"
    ]
  }

  Note: "Critiques of mercantilism" and "Transition to classical economics" are pedagogically relevant but not supported by this passage. Do not include them.

  ### Example 4 — avoid redundant angles

  BAD:
  {
    "angles": [
      "Causes of the war",
      "Reasons for conflict",
      "What led to the war",
      "Origins"
    ]
  }

  GOOD:
  {
    "angles": [
      "Religious causes",
      "Political causes"
    ]
  }

  The bad version has four angles that all ask the same thing. The good version distinguishes two genuinely different dimensions.

  ---

  Now process the input and return the JSON.
  `;
};

const renderRepairInstruction = (context: PromptAttemptContext): string => {
  const errorInstruction =
    context.previousErrorTag === "PromptOutputValidationError"
      ? "Your previous JSON response did not match the required schema."
      : "Your previous response was not valid JSON.";

  return [
    errorInstruction,
    'Return ONLY JSON with the exact shape: {"angles": string[]}.',
    "Do not include prose, markdown, explanations, or code fences.",
  ].join("\n");
};

export const GetAnglesPromptSpec: PromptSpec<
  GetAnglesPromptInput,
  GetAnglesPromptOutput
> = {
  promptId: "forge/get-angles",
  displayName: "Angle extraction",
  version: "1",
  inputSchema: GetAnglesPromptInputSchema,
  outputSchema: GetAnglesPromptOutputSchema,
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
        systemPrompt: renderSystemPrompt(),
        messages: [baseMessage],
      };
    }

    return {
      systemPrompt: renderSystemPrompt(),
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
    angles: output.angles,
  }),
};
