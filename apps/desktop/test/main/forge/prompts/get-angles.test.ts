import { Schema } from "@effect/schema";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { GetAnglesPromptSpec } from "@main/forge/prompts";

const sampleInput = {
  topic: "Photosynthesis converts sunlight into chemical energy in plant cells.",
  contextText: "Photosynthesis is a process used by plants and other organisms to convert light energy into chemical energy.",
};

describe("GetAnglesPromptSpec", () => {
  it("renders topic + context in the user message and a system prompt on first attempt", () => {
    const rendered = GetAnglesPromptSpec.render(sampleInput);

    expect(rendered.systemPrompt).toBeDefined();
    expect(rendered.systemPrompt?.length ?? 0).toBeGreaterThan(0);
    expect(rendered.messages).toHaveLength(1);

    const message = rendered.messages[0];
    expect(message).toBeDefined();
    if (!message || typeof message.content !== "string") {
      throw new Error("Expected rendered user message content to be a string.");
    }

    expect(message.role).toBe("user");
    expect(message.content).toContain(sampleInput.topic);
    expect(message.content).toContain(sampleInput.contextText);
  });

  it("renders retry-aware repair context on attempt 2+", () => {
    const rendered = GetAnglesPromptSpec.render(sampleInput, {
      attempt: 2,
      previousErrorTag: "PromptOutputValidationError",
      previousRawExcerpt: "{bad: json}",
    });

    expect(rendered.messages).toHaveLength(3);

    const assistantMessage = rendered.messages[1];
    expect(assistantMessage).toBeDefined();
    if (!assistantMessage || typeof assistantMessage.content !== "string") {
      throw new Error("Expected retry assistant message to be a string.");
    }
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toContain("{bad: json}");

    const repairMessage = rendered.messages[2];
    expect(repairMessage).toBeDefined();
    if (!repairMessage || typeof repairMessage.content !== "string") {
      throw new Error("Expected repair user message to be a string.");
    }
    expect(repairMessage.role).toBe("user");
    expect(repairMessage.content).toContain("did not match the required schema");
  });

  it("rejects empty topic or contextText at the input schema", async () => {
    const decodeTopicEmpty = Schema.decodeUnknown(GetAnglesPromptSpec.inputSchema)({
      topic: "",
      contextText: "non-empty",
    });
    await expect(Effect.runPromise(decodeTopicEmpty)).rejects.toThrow();

    const decodeContextEmpty = Schema.decodeUnknown(GetAnglesPromptSpec.inputSchema)({
      topic: "non-empty",
      contextText: "",
    });
    await expect(Effect.runPromise(decodeContextEmpty)).rejects.toThrow();
  });

  it("normalizes whitespace in output schema and drops empty entries", async () => {
    const decoded = await Effect.runPromise(
      Schema.decodeUnknown(GetAnglesPromptSpec.outputSchema)({
        angles: [
          "  Historical context  ",
          "",
          "Mechanism   of action",
          "   ",
          "Clinical implications",
        ],
      }),
    );

    expect(decoded).toEqual({
      angles: ["Historical context", "Mechanism of action", "Clinical implications"],
    });

    const normalized = GetAnglesPromptSpec.normalize(decoded, sampleInput);
    expect(normalized).toEqual(decoded);
  });

  it("rejects output whose angles array is empty after normalization", async () => {
    const decodeLiteralEmpty = Schema.decodeUnknown(GetAnglesPromptSpec.outputSchema)({
      angles: [],
    });
    await expect(Effect.runPromise(decodeLiteralEmpty)).rejects.toThrow();

    const decodeWhitespaceOnly = Schema.decodeUnknown(GetAnglesPromptSpec.outputSchema)({
      angles: ["   ", "", "\t\n"],
    });
    await expect(Effect.runPromise(decodeWhitespaceOnly)).rejects.toThrow();
  });
});
