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
    Analyze the full source and generate synthesis topics that connect ideas across sections, not just within one local passage.

    Each synthesis topic should:
    1. Be a single, self-contained sentence.
    2. Capture a higher-order relationship, contrast, evolution, causal chain, or thematic connection that depends on the source as a whole.
    3. Avoid simply restating one local detail from a single section.
    4. Be concrete enough that flashcards could later be generated from it.
    5. Use only information supported by the source.

    Good synthesis topics often explain:
    - how two or more ideas fit together
    - how a concept evolves across the source
    - why one distinction matters in the broader argument
    - what unifying pattern links multiple examples

    Return JSON with the exact shape:
    {
      "topics": [
        "<topic>"
      ]
    }

    Do not include prose, markdown, explanations, or code fences. Return only the JSON object.
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
  version: "1",
  inputSchema: GetSynthesisTopicsPromptInputSchema,
  outputSchema: GetSynthesisTopicsPromptOutputSchema,
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
        systemPrompt: input.sourceText,
        messages: [baseMessage],
      };
    }

    return {
      systemPrompt: input.sourceText,
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
