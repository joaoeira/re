import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { GeneratePermutationsPromptSpec } from "@main/forge/prompts";
import { CardQualityPrinciples } from "@main/forge/prompts/card-principles";

describe("GeneratePermutationsPromptSpec", () => {
  it("renders principles as system prompt and includes source card/instruction", () => {
    const rendered = GeneratePermutationsPromptSpec.render({
      contextText: "Chunk context",
      source: {
        question: "What is ATP?",
        answer: "ATP is the primary energy currency.",
      },
      instruction: "Use different angles.",
    });

    expect(rendered.systemPrompt).toBe(CardQualityPrinciples);
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain("What is ATP?");
    expect(message.content).toContain("Use different angles.");
    expect(message.content).toContain('"permutations": [');
  });

  it("renders fallback text when instruction is omitted", () => {
    const rendered = GeneratePermutationsPromptSpec.render({
      contextText: "Chunk context",
      source: {
        question: "What is osmosis?",
        answer: "It is passive transport of water.",
      },
    });

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.content).toContain("No additional instruction was provided.");
  });

  it("renders retry context and normalizes permutations in output schema", async () => {
    const rendered = GeneratePermutationsPromptSpec.render(
      {
        contextText: "Chunk context",
        source: {
          question: "What is osmosis?",
          answer: "It is passive transport of water.",
        },
      },
      {
        attempt: 2,
        previousErrorTag: "PromptOutputValidationError",
        previousRawExcerpt: '{"permutations":[1]}',
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
      Schema.decodeUnknown(GeneratePermutationsPromptSpec.outputSchema)({
        permutations: [
          { question: "  Define osmosis ", answer: " Movement of water across a membrane. " },
          { question: "Define osmosis", answer: "Movement of water across a membrane." },
          { question: "", answer: "discard me" },
          {
            question: "What drives osmosis?",
            answer: "  Solute concentration gradients across semipermeable membranes. ",
          },
        ],
      }),
    );

    expect(decoded).toEqual({
      permutations: [
        { question: "Define osmosis", answer: "Movement of water across a membrane." },
        {
          question: "What drives osmosis?",
          answer: "Solute concentration gradients across semipermeable membranes.",
        },
      ],
    });

    const normalized = GeneratePermutationsPromptSpec.normalize(decoded, {
      contextText: "Chunk context",
      source: {
        question: "What is osmosis?",
        answer: "It is passive transport of water.",
      },
    });

    expect(normalized).toEqual(decoded);
  });
});
