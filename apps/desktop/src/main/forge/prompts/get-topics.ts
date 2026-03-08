import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";
import { collapseWhitespace } from "./normalize";

export const GetTopicsPromptInputSchema = Schema.Struct({
  chunkText: Schema.String.pipe(Schema.minLength(1)),
});
export type GetTopicsPromptInput = typeof GetTopicsPromptInputSchema.Type;

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

const renderBaseUserPrompt = (_input: GetTopicsPromptInput): string => {
  return `
    Analyze the provided text and generate a series of informative statements that capture its key points and progression. Each statement should:
    1. Be a single, clear sentence expressing one main idea or event from the text, including relevant context.

    2. Provide enough detail to stand alone while still connecting to the broader narrative.
    3. Follow the text's original structure and flow of information.
    4. Be specific and concrete, avoiding abstract generalizations.
    5. Include relevant dates, names, and other contextual information when present in the original text.
    6. Exclude mentions of the author or the text itself.

    Ensure your summary:
    - Covers the entire text without omitting significant content.
    - Maintains the original sequence of ideas and events.
    - Uses declarative sentences that are informative and contextually rich.
    - Allows someone to understand the main points and context of the original text from these statements alone.

    Format your response as a JSON object with the following structure:

    Provide your response in JSON format with the following structure:
    {
      "topics": [
        "<topic>"
        "<topic>"
        ...
      ]
    }

    Do not include any other text or explanations in your response, just the JSON object, otherwise your response will be rejected.
    Do not wrap it in markdown code blocks, just return the JSON object
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

export const GetTopicsPromptSpec: PromptSpec<GetTopicsPromptInput, GetTopicsPromptOutput> = {
  promptId: "forge/get-topics",
  version: "1",
  inputSchema: GetTopicsPromptInputSchema,
  outputSchema: GetTopicsPromptOutputSchema,
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
        systemPrompt: input.chunkText,
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
      systemPrompt: input.chunkText,
      messages: repairMessages,
    };
  },
  normalize: (output) => ({
    topics: output.topics,
  }),
};
