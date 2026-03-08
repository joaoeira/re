import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { GenerateClozePromptSpec } from "@main/forge/prompts";

describe("GenerateClozePromptSpec", () => {
  it("renders without a system prompt and includes source card/instruction", () => {
    const rendered = GenerateClozePromptSpec.render({
      contextText: "Chunk context",
      source: {
        question: "What does ATP provide?",
        answer: "ATP provides energy for cellular work.",
      },
      instruction: "Prefer one to three deletions.",
    });

    expect(rendered.systemPrompt).toBeUndefined();
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain("Chunk context");
    expect(message.content).toContain("What does ATP provide?");
    expect(message.content).toContain("Prefer one to three deletions.");
    expect(message.content).toContain('"cloze"');
  });

  it("renders fallback text when instruction is omitted", () => {
    const rendered = GenerateClozePromptSpec.render({
      contextText: "Chunk context",
      source: {
        question: "What is diffusion?",
        answer: "Diffusion is movement from high to low concentration.",
      },
    });

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.content).toContain("No additional instruction was provided.");
  });

  it("renders retry context and normalizes cloze output in output schema", async () => {
    const rendered = GenerateClozePromptSpec.render(
      {
        contextText: "Chunk context",
        source: {
          question: "What is diffusion?",
          answer: "Diffusion is movement from high to low concentration.",
        },
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
      Schema.decodeUnknown(GenerateClozePromptSpec.outputSchema)({
        cloze: "  {{c1::ATP}} powers {{c2::cellular processes}}.  ",
      }),
    );

    expect(decoded).toEqual({
      cloze: "{{c1::ATP}} powers {{c2::cellular processes}}.",
    });

    const normalized = GenerateClozePromptSpec.normalize(decoded, {
      contextText: "Chunk context",
      source: {
        question: "What is ATP?",
        answer: "ATP is the primary energy currency.",
      },
    });

    expect(normalized).toEqual(decoded);
  });
});
