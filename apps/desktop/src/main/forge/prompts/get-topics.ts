import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";

export const GetTopicsPromptInputSchema = Schema.Struct({
  chunkText: Schema.String.pipe(Schema.minLength(1)),
  maxTopics: Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(100)),
});
export type GetTopicsPromptInput = typeof GetTopicsPromptInputSchema.Type;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeTopicList = (topics: ReadonlyArray<string>): ReadonlyArray<string> => {
  const normalizedTopics: string[] = [];

  for (const topic of topics) {
    const normalizedTopic = collapseWhitespace(topic);
    if (normalizedTopic.length === 0) {
      continue;
    }

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

export const GetTopicsPromptOutputSchema = Schema.Struct({
  topics: NormalizedTopicArraySchema,
});
export type GetTopicsPromptOutput = typeof GetTopicsPromptOutputSchema.Type;

const TOPICS_SYSTEM_PROMPT = [
  "You extract salient topics from source text.",
  'Return JSON only with the shape: {"topics": string[]}.',
  "Do not include markdown, prose, or code fences.",
].join("\n");

const renderBaseUserPrompt = (input: GetTopicsPromptInput): string => {
  const lines: string[] = [
    `Extract up to ${input.maxTopics} salient topics from the source text.`,
    `Maximum topics: ${input.maxTopics}.`,
    "<source_text>",
    input.chunkText,
    "</source_text>",
  ];

  return lines.filter((line) => line.length > 0).join("\n");
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

export const GetTopicsPromptSpec: PromptSpec<GetTopicsPromptInput, GetTopicsPromptOutput> = {
  promptId: "forge/get-topics",
  version: "1",
  inputSchema: GetTopicsPromptInputSchema,
  outputSchema: GetTopicsPromptOutputSchema,
  defaults: {
    model: "anthropic:claude-sonnet-4-20250514",
    temperature: 0.2,
    maxTokens: 1200,
  },
  render: (input, context) => {
    const baseMessage = {
      role: "user" as const,
      content: renderBaseUserPrompt(input),
    };

    if (!context || context.attempt <= 1) {
      return {
        systemPrompt: TOPICS_SYSTEM_PROMPT,
        messages: [baseMessage],
      };
    }

    const repairMessages = [
      baseMessage,
      {
        role: "assistant" as const,
        content: context.previousRawExcerpt ?? "",
      },
      {
        role: "user" as const,
        content: renderRepairInstruction(context),
      },
    ];

    return {
      systemPrompt: TOPICS_SYSTEM_PROMPT,
      messages: repairMessages,
    };
  },
  normalize: (output, input) => ({
    topics: output.topics.slice(0, input.maxTopics),
  }),
};
