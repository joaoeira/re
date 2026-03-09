import { Schema } from "@effect/schema";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeJsonToSchema,
  PromptOutputValidationError,
  ReformulateCardPromptSpec,
} from "@main/forge/prompts";
import { CardQualityPrinciples } from "@main/forge/prompts/card-principles";

const getFailure = <A, E>(exit: Exit.Exit<A, E>): E => {
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure exit.");
  }

  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "None") {
    throw new Error("Expected failure cause.");
  }

  return failure.value;
};

describe("ReformulateCardPromptSpec", () => {
  it("renders principles as system prompt and includes source context/card", () => {
    const rendered = ReformulateCardPromptSpec.render({
      contextText: "ATP stores and transfers energy in cells.",
      source: {
        question: "What does ATP do in the cell?",
        answer: "It stores and transfers energy.",
      },
    });

    expect(rendered.systemPrompt).toBe(CardQualityPrinciples);
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain("Rewrite this flashcard for maximum review value.");
    expect(message.content).toContain("ATP stores and transfers energy in cells.");
    expect(message.content).toContain("Q: What does ATP do in the cell?");
    expect(message.content).toContain("A: It stores and transfers energy.");
    expect(message.content).toContain('"question"');
    expect(message.content).toContain('"answer"');
  });

  it("renders retry context and normalizes rewritten output", async () => {
    const rendered = ReformulateCardPromptSpec.render(
      {
        contextText: "The Erie Canal lowered freight costs.",
        source: {
          question: "Why did it matter?",
          answer: "Because shipping got cheaper.",
        },
      },
      {
        attempt: 2,
        previousErrorTag: "PromptOutputValidationError",
        previousRawExcerpt: '{"question":1}',
      },
    );

    expect(rendered.messages).toHaveLength(3);
    const repairMessage = rendered.messages[2];
    expect(repairMessage).toBeDefined();
    if (!repairMessage || typeof repairMessage.content !== "string") {
      throw new Error("Expected repair user message to be a string.");
    }
    expect(repairMessage.content).toContain("did not match the required schema");

    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(ReformulateCardPromptSpec.outputSchema)({
        question: "  Why did the Erie Canal matter to northeastern markets? ",
        answer: " It sharply reduced freight costs. ",
      }),
    );

    expect(decoded).toEqual({
      question: "Why did the Erie Canal matter to northeastern markets?",
      answer: "It sharply reduced freight costs.",
    });

    const normalized = ReformulateCardPromptSpec.normalize(decoded, {
      contextText: "The Erie Canal lowered freight costs.",
      source: {
        question: "Why did it matter?",
        answer: "Because shipping got cheaper.",
      },
    });

    expect(normalized).toEqual(decoded);
  });

  it("returns a specific validation message for empty normalized cards", async () => {
    const exit = await Effect.runPromiseExit(
      decodeJsonToSchema(
        ReformulateCardPromptSpec.outputSchema,
        '{"question":"   ","answer":"\\n\\t"}',
        ReformulateCardPromptSpec.promptId,
      ),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptOutputValidationError);
    if (failure instanceof PromptOutputValidationError) {
      expect(failure.message).toContain(
        "Card question and answer must both contain non-empty text after normalization.",
      );
      expect(failure.message).not.toContain("Predicate refinement failure");
    }
  });
});
