import { Schema } from "@effect/schema";
import { describe, expect, it } from "vitest";

import { createForgePromptRegistry, type PromptSpec } from "@main/forge/prompts";

type TestInput = {
  readonly value: string;
};

type TestOutput = {
  readonly value: string;
};

const TestInputSchema = Schema.Struct({
  value: Schema.String.pipe(Schema.minLength(1)),
});

const TestOutputSchema = Schema.Struct({
  value: Schema.String,
});

const makeSpec = (promptId: string, version: string): PromptSpec<TestInput, TestOutput> => ({
  promptId,
  displayName: promptId,
  version,
  inputSchema: TestInputSchema,
  outputSchema: TestOutputSchema,
  defaults: {},
  render: (input) => ({
    messages: [
      {
        role: "user",
        content: input.value,
      },
    ],
  }),
  normalize: (output) => output,
});

describe("createForgePromptRegistry", () => {
  it("indexes prompt specs by promptId and prompt key", () => {
    const first = makeSpec("forge/one", "1");
    const second = makeSpec("forge/two", "2");

    const registry = createForgePromptRegistry([first, second]);

    expect(registry.all).toEqual([first, second]);
    expect(registry.byPromptId.get("forge/one")).toBe(first);
    expect(registry.byPromptId.get("forge/two")).toBe(second);
    expect(registry.byPromptKey.get("forge/one@1")).toBe(first);
    expect(registry.byPromptKey.get("forge/two@2")).toBe(second);
  });

  it("throws on duplicate prompt key", () => {
    expect(() =>
      createForgePromptRegistry([makeSpec("forge/dup", "1"), makeSpec("forge/dup", "1")]),
    ).toThrowError("Duplicate Forge prompt key detected: forge/dup@1");
  });

  it("throws on duplicate promptId across versions", () => {
    expect(() =>
      createForgePromptRegistry([makeSpec("forge/dup", "1"), makeSpec("forge/dup", "2")]),
    ).toThrowError("Duplicate Forge promptId detected: forge/dup");
  });
});
