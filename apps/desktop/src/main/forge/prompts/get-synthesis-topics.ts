import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";
import { collapseWhitespace } from "./normalize";

export const GetSynthesisTopicsPromptInputSchema = Schema.Struct({
  sourceText: Schema.String.pipe(Schema.minLength(1)),
});
export type GetSynthesisTopicsPromptInput = typeof GetSynthesisTopicsPromptInputSchema.Type;

const normalizeTopicList = (topics: ReadonlyArray<string>): ReadonlyArray<string> => {
  const normalizedTopics: string[] = [];
  const seen = new Set<string>();

  for (const topic of topics) {
    const normalizedTopic = collapseWhitespace(topic);
    if (normalizedTopic.length === 0 || seen.has(normalizedTopic)) {
      continue;
    }

    seen.add(normalizedTopic);
    normalizedTopics.push(normalizedTopic);
  }

  return normalizedTopics;
};

const NormalizedTopicArraySchema = Schema.transform(
  Schema.Array(Schema.String),
  Schema.Array(Schema.String),
  {
    strict: true,
    decode: (topics) => normalizeTopicList(topics),
    encode: (topics) => topics,
  },
);

export const GetSynthesisTopicsPromptOutputSchema = Schema.Struct({
  topics: NormalizedTopicArraySchema,
});
export type GetSynthesisTopicsPromptOutput = typeof GetSynthesisTopicsPromptOutputSchema.Type;

const renderBaseUserPrompt = (_input: GetSynthesisTopicsPromptInput): string => {
  return `
    Analyze the provided text and generate a series of integrative topic statements that capture its major thematic threads, structural arguments, and higher-order points. These should synthesize across multiple sections of the text while remaining firmly anchored to its specific subject matter.

Each statement should:
1. Synthesize multiple related details from the text into a single thematic claim about the specific people, entities, technologies, or ideas the text discusses.
2. Articulate what the text is building toward or leading the reader to conclude, even when this is not stated in any single sentence.
3. Preserve the specific names, entities, and context of the text. These are not abstract generalizations but integrated claims about the text's actual subject matter.
4. Represent a thread that runs across multiple paragraphs or sections, not a point made in a single passage.
5. Use language that mirrors the text's own register. If the text describes a tradeoff neutrally, state it as a tradeoff. If the text says something "adds complexity," do not escalate this to "severe limitations." If the text presents an advantage without qualification, you may state it directly. Treat the text's word choices and hedges as a ceiling on your own assertiveness.
6. Be as short as possible while remaining a complete, self-contained claim. Strip every word that doesn't carry meaning. Prefer concrete nouns and active verbs over abstract phrasing and nominalizations. If a statement can lose a clause without losing correctness or necessary context, lose the clause.

To generate these, consider:
- What larger points do clusters of individual facts or events collectively support?
- What tensions, dynamics, or relationships does the text develop across multiple sections?
- What is the text building the reader up to understand that goes beyond any single paragraph?
- What causal chains or structural explanations connect the text's individual claims?
- What motivates or frames the discussion — why does this text exist, what question is it responding to, and what context makes it timely?
- Where the text examines multiple sides of a comparison, each side's strengths and constraints should be captured with comparable depth. If the text gives symmetric treatment to two technologies, frameworks, or positions, your topics should reflect that symmetry.
- Where the text distinguishes between different categories, use cases, or paradigms within the same broad subject, preserve those distinctions as separate topics rather than merging them.

Ensure your output:
- Covers the full scope of the text. Do not selectively extract topics that build toward a single narrative while ignoring threads that complicate or balance it.
- Captures the text's own framing and motivation, not just its technical content.
- Avoids redundancy. Each topic should cover distinct thematic ground. If two candidate topics substantially overlap, merge them or keep only the one that captures more of the text's structure.

Do NOT:
- Editorialize beyond the text's own level of certainty. If the text presents something as one factor among several, do not present it as the decisive factor. If the text calls something "possible but complex," do not call it "severe" or a "burden."
- Summarize individual sentences or paragraphs in isolation.
- Produce abstract principles or generalizable lessons stripped of the text's specific subject matter.
- Reference the text, the author, or the act of reading (e.g., "The text argues..." or "The chapter shows...").
- Use throat-clearing phrases ("It is worth noting that," "This reflects the broader dynamic whereby," "What emerges from this is"). Start each statement with its subject.
- Use two words where one suffices. Prefer "X causes Y" over "X plays a significant role in shaping Y." Prefer "X limits Y" over "X introduces meaningful constraints on Y."
- Pad statements with hedged qualifiers unless the text itself hedges. If the text states something directly, state it directly.

Format your response as a JSON object:
{
  "topics": [
    "<statement>",
    "<statement>",
    ...
  ]
}

Do not include any other text or explanations in your response, just the JSON object.
Do not wrap it in markdown code blocks, just return the JSON object.
Target length: each statement should be 1–2 sentences. If a statement requires 3 sentences, it is probably two topics or contains redundancy. Err on the side of a shorter statement that omits a minor nuance over a longer one that captures everything.
  `;
};

const renderRepairInstruction = (context: PromptAttemptContext): string => {
  const errorInstruction =
    context.previousErrorTag === "PromptOutputValidationError"
      ? "Your previous JSON response did not match the required schema."
      : "Your previous response was not valid JSON.";

  return [
    errorInstruction,
    'Return ONLY JSON with the exact shape: {"topics": string[]}.',
    "Do not include prose, markdown, explanations, or code fences.",
  ].join("\n");
};

export const GetSynthesisTopicsPromptSpec: PromptSpec<
  GetSynthesisTopicsPromptInput,
  GetSynthesisTopicsPromptOutput
> = {
  promptId: "forge/get-synthesis-topics",
  displayName: "Synthesis topics",
  version: "1",
  inputSchema: GetSynthesisTopicsPromptInputSchema,
  outputSchema: GetSynthesisTopicsPromptOutputSchema,
  defaults: {
    temperature: 1.0,
  },
  render: (input, context) => {
    const baseMessage = {
      role: "user" as const,
      content: input.sourceText,
    };

    if (!context || context.attempt <= 1) {
      return {
        systemPrompt: renderBaseUserPrompt(input),
        messages: [baseMessage],
      };
    }

    return {
      systemPrompt: renderBaseUserPrompt(input),
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
    topics: output.topics,
  }),
};
