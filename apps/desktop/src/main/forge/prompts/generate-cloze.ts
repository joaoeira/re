import { Schema } from "@effect/schema";

import type { PromptAttemptContext, PromptSpec } from "./types";

const SourceCardSchema = Schema.Struct({
  question: Schema.String.pipe(Schema.minLength(1)),
  answer: Schema.String.pipe(Schema.minLength(1)),
});

export const GenerateClozePromptInputSchema = Schema.Struct({
  chunkText: Schema.String.pipe(Schema.minLength(1)),
  source: SourceCardSchema,
  instruction: Schema.optional(Schema.String),
});
export type GenerateClozePromptInput =
  typeof GenerateClozePromptInputSchema.Type;

const NormalizedClozeTextSchema = Schema.transform(
  Schema.String,
  Schema.String,
  {
    strict: true,
    decode: (clozeText) => clozeText.trim(),
    encode: (clozeText) => clozeText,
  },
);

export const GenerateClozePromptOutputSchema = Schema.Struct({
  cloze: NormalizedClozeTextSchema.pipe(Schema.minLength(1)),
});
export type GenerateClozePromptOutput =
  typeof GenerateClozePromptOutputSchema.Type;

const renderInstructionBlock = (instruction: string | undefined): string => {
  const trimmedInstruction = instruction?.trim();
  if (!trimmedInstruction) {
    return "No additional instruction was provided.";
  }

  return `Additional instruction:\n${trimmedInstruction}`;
};

const renderBaseUserPrompt = (input: GenerateClozePromptInput): string => {
  return `
 You are an AI assistant specialized in creating cloze deletion cards from question and answer pairs. Your task is to analyze the given question and answer, identify the most important information, and create a cloze deletion sentence from it.

  <guidelines>

  1. **Integrate Question and Answer**: Combine the given question and answer into a single, coherent statement reflecting the core information.

  2. **Identify Key Information**: Carefully analyze all elements of both the question and the answer to identify key pieces of information. This includes:
    - Names of individuals, groups, organizations, and places.
    - Dates, years, and numerical dat.
    - Important terms, concepts, and specific phrases that are critical for understanding the context.

  3. **Prioritize Essential Context**: Focus on all terms, phrases, and details that contribute to a complete understanding of the subject matter. Ensure that no significant or relevant information is omitted.

  4. **Create Cloze Deletions**: Use the format {{cN::text::hint}} for all identified key information, ensuring:
    - Each cloze deletion captures a distinct piece of critical information.
    - The hint provides a clear clue for recalling the hidden information.

  5. **Review for Comprehensiveness**: Ensure that the resulting cloze deletions fully encompass all significant details and allow for a robust understanding of the topic across various fields.
  </guidelines>

  Source card:
  Question: ${input.source.question}
  Answer: ${input.source.answer}

  Provide your response in JSON format with the following structure:
  {
    "cloze": "<text with {{c1::...}} style cloze deletions>"
  }
  Do not include any other text or explanations in your response, just the JSON object, otherwise your response will be rejected.

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
    'Return ONLY JSON with the exact shape: {"cloze": string}.',
    "Do not include prose, markdown, explanations, or code fences.",
  ].join("\n");
};

export const GenerateClozePromptSpec: PromptSpec<
  GenerateClozePromptInput,
  GenerateClozePromptOutput
> = {
  promptId: "forge/generate-cloze",
  version: "1",
  inputSchema: GenerateClozePromptInputSchema,
  outputSchema: GenerateClozePromptOutputSchema,
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
        messages: [baseMessage],
      };
    }

    return {
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
    cloze: output.cloze,
  }),
};
