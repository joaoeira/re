import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { GetTopicsPromptSpec } from "@main/forge/prompts";

describe("GetTopicsPromptSpec", () => {
  it("renders dynamic variables with source tags", () => {
    const rendered = GetTopicsPromptSpec.render({
      chunkText: "The mitochondria is the powerhouse of the cell.",
      maxTopics: 5,
    });

    expect(rendered.systemPrompt).toContain("Return JSON only");
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain("Maximum topics: 5.");
    expect(message.content).toContain("<source_text>");
    expect(message.content).toContain("</source_text>");
  });

  it("renders retry-aware repair context for attempt 2+", () => {
    const rendered = GetTopicsPromptSpec.render(
      {
        chunkText: "Only required fields.",
        maxTopics: 3,
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

  it("normalizes whitespace, removes empties, and preserves input order", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(GetTopicsPromptSpec.outputSchema)({
        topics: [
          "  Biology  ",
          "biology",
          "",
          "Data   Science",
          "  data science  ",
          "  Chemistry  ",
        ],
      }),
    );

    expect(decoded).toEqual({
      topics: ["Biology", "biology", "Data Science", "data science", "Chemistry"],
    });

    const normalized = GetTopicsPromptSpec.normalize(decoded, {
      chunkText: "irrelevant",
      maxTopics: 2,
    });

    expect(normalized).toEqual({
      topics: ["Biology", "biology"],
    });
  });
});
