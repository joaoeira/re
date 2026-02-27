import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CreateCardsPromptSpec } from "@main/forge/prompts";
import { CardQualityPrinciples } from "@main/forge/prompts/card-principles";

describe("CreateCardsPromptSpec", () => {
  it("renders principles as system prompt and includes topic/instruction in user message", () => {
    const rendered = CreateCardsPromptSpec.render({
      chunkText: "Chunk context",
      topic: "ATP synthesis",
      instruction: "Keep questions short.",
    });

    expect(rendered.systemPrompt).toBe(CardQualityPrinciples);
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain("ATP synthesis");
    expect(message.content).toContain("Keep questions short.");
    expect(message.content).toContain('"cards": [');
  });

  it("renders fallback text when instruction is omitted", () => {
    const rendered = CreateCardsPromptSpec.render({
      chunkText: "Chunk context",
      topic: "Cell membranes",
    });

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.content).toContain("No additional instruction was provided.");
  });

  it("renders retry context and normalizes cards in output schema", async () => {
    const rendered = CreateCardsPromptSpec.render(
      {
        chunkText: "Chunk context",
        topic: "Mitochondria",
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
      Schema.decodeUnknown(CreateCardsPromptSpec.outputSchema)({
        cards: [
          { question: "  What   is ATP? ", answer: " Primary energy currency. " },
          { question: "", answer: "discard me" },
          { question: "What is ATP?", answer: "Primary energy currency." },
          { question: "Where is it made?", answer: "  Mostly in mitochondria.  " },
        ],
      }),
    );

    expect(decoded).toEqual({
      cards: [
        { question: "What is ATP?", answer: "Primary energy currency." },
        { question: "Where is it made?", answer: "Mostly in mitochondria." },
      ],
    });

    const normalized = CreateCardsPromptSpec.normalize(decoded, {
      chunkText: "Chunk context",
      topic: "Mitochondria",
    });

    expect(normalized).toEqual(decoded);
  });
});
