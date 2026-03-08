import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { GetSynthesisTopicsPromptSpec } from "@main/forge/prompts";

describe("GetSynthesisTopicsPromptSpec", () => {
  it("renders source text as system prompt and JSON-only user instructions", () => {
    const sourceText = "A long source that connects multiple related ideas.";
    const rendered = GetSynthesisTopicsPromptSpec.render({ sourceText });

    expect(rendered.systemPrompt).toBe(sourceText);
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain("generate synthesis topics");
    expect(message.content).toContain('"topics": [');
    expect(message.content).toContain("Return only the JSON object");
  });

  it("renders retry-aware repair context for attempt 2+", () => {
    const rendered = GetSynthesisTopicsPromptSpec.render(
      {
        sourceText: "Only required fields.",
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

    const repairMessage = rendered.messages[2];
    expect(repairMessage).toBeDefined();
    if (!repairMessage || typeof repairMessage.content !== "string") {
      throw new Error("Expected repair user message to be a string.");
    }

    expect(repairMessage.role).toBe("user");
    expect(repairMessage.content).toContain("not valid JSON");
  });

  it("normalizes whitespace and deduplicates in output schema", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(GetSynthesisTopicsPromptSpec.outputSchema)({
        topics: [
          "  One big idea  ",
          "",
          "Cross-cutting   relation",
          "One big idea",
          "Cross-cutting relation",
        ],
      }),
    );

    expect(decoded).toEqual({
      topics: ["One big idea", "Cross-cutting relation"],
    });

    const normalized = GetSynthesisTopicsPromptSpec.normalize(decoded, {
      sourceText: "irrelevant",
    });

    expect(normalized).toEqual(decoded);
  });
});
