import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CreateSynthesisCardsPromptSpec } from "@main/forge/prompts";
import { CardQualityPrinciples } from "@main/forge/prompts/card-principles";

describe("CreateSynthesisCardsPromptSpec", () => {
  it("renders instructions as system prompt and source/topic/instruction as user message (control vs data plane)", () => {
    const rendered = CreateSynthesisCardsPromptSpec.render({
      contextText: "Whole-source context",
      topic: "How two theories relate",
      instruction: "Prefer contrastive cards.",
    });

    expect(rendered.systemPrompt).toContain(CardQualityPrinciples);
    expect(rendered.systemPrompt).toContain("synthesis flashcards");
    expect(rendered.systemPrompt).toContain('"cards": [');
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain("Whole-source context");
    expect(message.content).toContain("How two theories relate");
    expect(message.content).toContain("Prefer contrastive cards.");
  });

  it("omits instruction block when instruction is not provided", () => {
    const rendered = CreateSynthesisCardsPromptSpec.render({
      contextText: "Whole-source context",
      topic: "Why the distinction matters",
    });

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.content).toContain("Whole-source context");
    expect(message.content).toContain("Why the distinction matters");
    expect(message.content).not.toContain("Additional instruction");
  });

  it("renders retry context and normalizes cards in output schema", async () => {
    const rendered = CreateSynthesisCardsPromptSpec.render(
      {
        contextText: "Whole-source context",
        topic: "How the ideas connect",
      },
      {
        attempt: 2,
        previousErrorTag: "PromptOutputParseError",
        previousRawExcerpt: "not-json",
      },
    );

    expect(rendered.messages).toHaveLength(3);
    const assistantMessage = rendered.messages[1];
    expect(assistantMessage).toBeDefined();
    if (!assistantMessage || typeof assistantMessage.content !== "string") {
      throw new Error("Expected retry assistant message to be a string.");
    }
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toContain("not-json");

    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(CreateSynthesisCardsPromptSpec.outputSchema)({
        cards: [
          { question: "  How do they differ? ", answer: " One is associative. " },
          { question: "", answer: "discard me" },
          { question: "How do they differ?", answer: "One is associative." },
          { question: "Why does timing matter?", answer: "  It changes learning outcomes.  " },
        ],
      }),
    );

    expect(decoded).toEqual({
      cards: [
        { question: "How do they differ?", answer: "One is associative." },
        { question: "Why does timing matter?", answer: "It changes learning outcomes." },
      ],
    });

    const normalized = CreateSynthesisCardsPromptSpec.normalize(decoded, {
      contextText: "Whole-source context",
      topic: "How the ideas connect",
    });

    expect(normalized).toEqual(decoded);
  });
});
