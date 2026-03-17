import { Schema } from "@effect/schema";

import type {
  PromptAttemptContext,
  PromptSpec,
} from "@main/forge/prompts/types";
import { CardQualityPrinciples } from "@main/forge/prompts/card-principles";
import { ReviewAssistantQaSourceCardSchema } from "@shared/rpc/schemas/review";

export const GenerateReviewPermutationsPromptInputSchema = Schema.Struct({
  sourceCard: ReviewAssistantQaSourceCardSchema,
  instruction: Schema.optional(Schema.String),
});

export type GenerateReviewPermutationsPromptInput =
  typeof GenerateReviewPermutationsPromptInputSchema.Type;

const RawPermutationSchema = Schema.Struct({
  question: Schema.String,
  answer: Schema.String,
});

export const GenerateReviewPermutationsPromptOutputSchema = Schema.Struct({
  permutations: Schema.Array(RawPermutationSchema),
});

export type GenerateReviewPermutationsPromptOutput =
  typeof GenerateReviewPermutationsPromptOutputSchema.Type;

const renderInstructionBlock = (instruction: string | undefined): string => {
  const trimmedInstruction = instruction?.trim();
  if (!trimmedInstruction) {
    return "No additional instruction was provided.";
  }

  return `Additional instruction:\n${trimmedInstruction}`;
};

const renderBaseUserPrompt = (
  input: GenerateReviewPermutationsPromptInput,
): string => {
  const { question, answer } = input.sourceCard.content;

  return `

Create diverse sets of permutation cards to prevent pattern matching in spaced repetition learning:

  Generate multiple variations of a single question or concept by:
    a. Changing key elements such as subject, object, or relationship
    b. Reversing the question-answer format
    c. Altering the perspective or context
    d. Using different levels of specificity
    e. Introducing negatives or opposites

  Ensure each permutation requires critical thinking about the specific variation presented.
  Create permutations that test related concepts or implications of the original fact.
  Vary the linguistic structure of questions to prevent language-based pattern matching.

  Follow these guidelines for each set of permutation cards:

  Maintain consistent difficulty across permutations
  Ensure each permutation tests a distinct aspect of the same core concept or related concepts
  Include at least one reversal (swapping question and answer) where applicable

  1. **Clarify the Core Concept**: Begin by identifying the central idea or fact to focus on. Ensure that this concept is clearly defined and understood, as it will guide the creation of both questions and answers.

  2. **Generate Multiple Questions**:
    - Create questions that approach the core concept from different angles.
    - Use various phrasing, structures, and contexts to keep each question distinct.
    - Incorporate different aspects of the topic (historical significance, implications, related events, etc.) in each question.

  3. **Develop Varied Answers**:
    - Formulate different answers that convey the same or related concepts but are articulated in unique ways.
    - Use synonyms and alternative expressions to restate the core idea.
    - Include related concepts that stem from the main idea, offering broader context or implications.
    - Ensure answers can stand alone and make sense without needing the original question.

  4. **Encourage Critical Thinking**:
    - Pose questions that require deeper cognitive processing, encouraging the learner to engage with the material rather than merely recalling facts.
    - Include scenarios or hypothetical situations that pertain to the core concept.

  5. **Avoid Repetition**:
    - Ensure that no two questions or answers are phrased similarly. Strive for uniqueness in each pair.
    - Make use of different formats, such as using reversals (turning a question into the answer and vice versa), to maintain engagement and attention.

  6. **Incorporate Contextual Variation**:
    - Contextualize questions in various historical, cultural, or situational frameworks relevant to the concept.
    - Mix specificity with generality, so that some questions are broad while others delve into particular details.

  7. **Review for Consistency and Clarity**:
    - Once the pairs are created, review them to ensure clarity, precision, and conciseness in both questions and answers.
    - Confirm that each question-answer pair accurately reflects the core concept and that the answers directly relate to their respective questions.

<good examples>
  Original:
    Q: What is the primary function of photosynthesis in plants?
    A: To convert light energy into chemical energy that can be used by the plant
  Permutations:
    Q: In plants, what process converts light energy into chemical energy?
    A: Photosynthesis
    Q: What type of energy does photosynthesis convert into chemical energy in plants?
    A: Light energy
    Q: The conversion of light energy to chemical energy in plants is the primary function of which process?
    A: Photosynthesis
    Q: What form of energy does photosynthesis produce for use by plants?
    A: Chemical energy
    Q: Photosynthesis in plants primarily functions to convert what into what?
    A: Light energy into chemical energy
    Q: Which energy transformation describes the main purpose of photosynthesis in plants?
    A: The conversion of light energy to chemical energy

  These permutations stay true to the information provided in the original question and answer. They approach the concept from different angles, reverse the question-answer format in some cases, and vary the linguistic structure to prevent pattern matching. Each permutation focuses on the core concept of energy conversion in photosynthesis without introducing additional information not present in the original card.
  </good examples>

  <bad examples>
  Original:
    Q: What is the primary function of photosynthesis in plants?
    A: To convert light energy into chemical energy that can be used by the plant
  Permutations:
    Q: What does photosynthesis do?
    A: It converts light energy into chemical energy that can be used by the plant
    Q: Explain the entire process of photosynthesis, including all steps and chemical reactions.
    A: Photosynthesis converts light energy into chemical energy that can be used by the plant. It involves light-dependent reactions in the thylakoid membrane and the Calvin cycle in the stroma. The process uses water, carbon dioxide, and light to produce glucose and oxygen...
    Q: Is photosynthesis important for plants?
    A: Yes
    Q: What's that thing plants do with sunlight again?
    A: Convert light energy into chemical energy that can be used by the plant
    Q: In the textbook we read last week, what did it say about photosynthesis?
    A: It converts light energy into chemical energy that can be used by the plant
    Q: Photosynthesis converts light energy into chemical energy that can be used by the plant. True or False?
    A: True
    Q: Which of the following is true about photosynthesis?
    a) It produces oxygen
    b) It uses carbon dioxide
    c) It occurs in chloroplasts
    d) It converts light energy into chemical energy
    A: d) It converts light energy into chemical energy

    These bad permutations demonstrate several issues:

    They don't vary the answer, repeatedly using the same phrasing.
    Some questions are overly vague or imprecise.
    Some include information not in the original card or ask for more detail than provided.
    They use yes/no and true/false formats, which are discouraged.
    Some rely on external context not provided in the card.
    They don't encourage critical thinking or deeper engagement with the material.
    The multiple-choice question introduces new information not present in the original card.
  </bad examples>

{
----

Source card:
Question: ${question}
Answer: ${answer}

---

    Provide your response in JSON format with the following structure:
    {
      "permutations": [
        {
          "question": "<question>",
          "answer": "<answer>"
        }
      ]
    }

  Do not include any other text or explanations in your response, just the JSON object, otherwise your response will be rejected. It is imperative that you follow the instructions on how to create permutations.

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
    'Return ONLY JSON with the exact shape: {"permutations":[{"question": string, "answer": string}]}.',
    "Do not include prose, markdown, explanations, or code fences.",
  ].join("\n");
};

export const GenerateReviewPermutationsPromptSpec: PromptSpec<
  GenerateReviewPermutationsPromptInput,
  GenerateReviewPermutationsPromptOutput
> = {
  promptId: "review/generate-permutations",
  version: "1",
  inputSchema: GenerateReviewPermutationsPromptInputSchema,
  outputSchema: GenerateReviewPermutationsPromptOutputSchema,
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
    permutations: output.permutations,
  }),
};
