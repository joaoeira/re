import { Schema } from "@effect/schema";
import { Cause, Effect, Exit, Schedule, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { AiClient } from "@main/ai/ai-client";
import type { AiModelCatalog } from "@main/ai/model-catalog";
import type { PromptModelResolver } from "@main/ai/prompt-model-resolver";
import {
  PromptInputValidationError,
  PromptModelInvocationError,
  PromptNormalizationError,
  PromptOutputParseError,
  PromptOutputValidationError,
  type PromptAttemptContext,
  type PromptSpec,
} from "@main/forge/prompts";
import { makeForgePromptRuntime } from "@main/forge/services/prompt-runtime";
import {
  AiModelNotFound,
  PromptModelResolutionFailed,
  type AiModelDefinition,
  type ResolvedAiModel,
} from "@shared/ai-models";
import { AiRateLimitError, type AiGenerateTextResult } from "@shared/rpc/schemas/ai";

type TestInput = {
  readonly chunkText: string;
  readonly maxTopics: number;
};

type TestOutput = {
  readonly topics: ReadonlyArray<string>;
};

const TestInputSchema = Schema.Struct({
  chunkText: Schema.String.pipe(Schema.minLength(1)),
  maxTopics: Schema.Number.pipe(Schema.int(), Schema.positive()),
});

const TestOutputSchema = Schema.Struct({
  topics: Schema.Array(Schema.String),
});

const ANTHROPIC_MODEL: ResolvedAiModel = {
  key: "anthropic/claude-sonnet-4-20250514",
  providerId: "anthropic",
  providerModelId: "claude-sonnet-4-20250514",
  displayName: "Claude Sonnet 4",
};

const OPENAI_GPT4O_MODEL: ResolvedAiModel = {
  key: "openai/gpt-4o",
  providerId: "openai",
  providerModelId: "gpt-4o",
  displayName: "OpenAI GPT-4o",
};

const toModelDefinition = (model: ResolvedAiModel): AiModelDefinition => ({
  ...model,
});

const makeSpec = (
  options: {
    readonly normalize?: (output: TestOutput, input: TestInput) => TestOutput;
    readonly render?: (input: TestInput, context?: PromptAttemptContext) => string;
  } = {},
): PromptSpec<TestInput, TestOutput> => ({
  promptId: "forge/test-prompt",
  displayName: "Test prompt",
  version: "1",
  inputSchema: TestInputSchema,
  outputSchema: TestOutputSchema,
  defaults: {
    temperature: 0.2,
    maxTokens: 500,
  },
  render: (input, context) => ({
    systemPrompt: "JSON only",
    messages: [
      {
        role: "user",
        content: options.render
          ? options.render(input, context)
          : `<source_text>${input.chunkText}</source_text>`,
      },
    ],
  }),
  normalize:
    options.normalize ??
    ((output, input) => ({
      topics: output.topics.slice(0, input.maxTopics),
    })),
});

const makeGenerateResult = (text: string): AiGenerateTextResult => ({
  text,
  finishReason: "stop",
  model: "mock:model",
  usage: {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  },
});

const makeAiClient = (impl: AiClient["generateText"]): AiClient => ({
  generateText: impl,
  streamText: () => Stream.empty,
});

const makeAiModelCatalog = (
  models: ReadonlyArray<AiModelDefinition> = [
    toModelDefinition(ANTHROPIC_MODEL),
    toModelDefinition(OPENAI_GPT4O_MODEL),
  ],
  applicationDefaultModelKey: string = ANTHROPIC_MODEL.key,
): AiModelCatalog => ({
  getModel: (key) => {
    const model = models.find((candidate) => candidate.key === key);
    return model === undefined
      ? Effect.fail(new AiModelNotFound({ modelKey: key }))
      : Effect.succeed(model);
  },
  listModels: () => Effect.succeed(models),
  getApplicationDefaultModelKey: () => Effect.succeed(applicationDefaultModelKey),
});

const makePromptModelResolver = (
  resolvedModel: ResolvedAiModel = ANTHROPIC_MODEL,
): PromptModelResolver => ({
  resolve: () =>
    Effect.succeed({
      model: resolvedModel,
      source: "catalog-default" as const,
    }),
});

const makeRuntime = (
  impl: AiClient["generateText"],
  options: {
    readonly aiModelCatalog?: AiModelCatalog;
    readonly promptModelResolver?: PromptModelResolver;
  } = {},
) =>
  makeForgePromptRuntime({
    aiClient: makeAiClient(impl),
    aiModelCatalog: options.aiModelCatalog ?? makeAiModelCatalog(),
    promptModelResolver: options.promptModelResolver ?? makePromptModelResolver(),
  });

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

describe("ForgePromptRuntime", () => {
  it("returns typed output and metadata on happy path", async () => {
    const generateText = vi
      .fn<AiClient["generateText"]>()
      .mockImplementation(() =>
        Effect.succeed(makeGenerateResult('{"topics":["math","science"]}')),
      );

    const runtime = makeRuntime(generateText);

    const result = await Effect.runPromise(
      runtime.run(
        makeSpec(),
        {
          chunkText: "math and science",
          maxTopics: 3,
        },
        {
          model: "openai:gpt-4o",
        },
      ),
    );

    expect(result.output).toEqual({ topics: ["math", "science"] });
    expect(result.rawText).toBe('{"topics":["math","science"]}');
    expect(result.metadata.promptId).toBe("forge/test-prompt");
    expect(result.metadata.promptVersion).toBe("1");
    expect(result.metadata.model).toBe("openai/gpt-4o");
    expect(result.metadata.attemptCount).toBe(1);
    expect(result.metadata.promptHash).toHaveLength(64);
    expect(result.metadata.outputChars).toBe(result.rawText.length);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRetries: 0,
      }),
    );
  });

  it("passes retry context to render for corrective retries", async () => {
    const seenContexts: Array<PromptAttemptContext | undefined> = [];
    let callCount = 0;

    const runtime = makeRuntime(() => {
      callCount += 1;

      if (callCount === 1) {
        return Effect.succeed(makeGenerateResult("not-json"));
      }

      return Effect.succeed(makeGenerateResult('{"topics":["biology"]}'));
    });

    await Effect.runPromise(
      runtime.run(
        makeSpec({
          render: (_input, context) => {
            seenContexts.push(context);
            return "prompt";
          },
        }),
        {
          chunkText: "biology",
          maxTopics: 3,
        },
      ),
    );

    expect(seenContexts).toHaveLength(2);
    expect(seenContexts[0]).toEqual({ attempt: 1 });
    expect(seenContexts[1]).toEqual({
      attempt: 2,
      previousErrorTag: "PromptOutputParseError",
      previousRawExcerpt: "not-json",
    });
  });

  it("surfaces typed model resolution failures before invoking the AI client", async () => {
    const generateText = vi
      .fn<AiClient["generateText"]>()
      .mockImplementation(() =>
        Effect.succeed(makeGenerateResult('{"topics":["math","science"]}')),
      );

    const runtime = makeRuntime(generateText, {
      promptModelResolver: {
        resolve: () =>
          Effect.fail(
            new PromptModelResolutionFailed({
              promptId: "forge/test-prompt",
              message: "No model candidates are configured for this prompt.",
            }),
          ),
      },
    });

    const exit = await Effect.runPromiseExit(
      runtime.run(makeSpec(), {
        chunkText: "math and science",
        maxTopics: 3,
      }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptModelResolutionFailed);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("retries once on parse failure then succeeds", async () => {
    let callCount = 0;

    const runtime = makeRuntime(() => {
      callCount += 1;

      if (callCount === 1) {
        return Effect.succeed(makeGenerateResult("this is not json"));
      }

      return Effect.succeed(makeGenerateResult('{"topics":["biology"]}'));
    });

    const result = await Effect.runPromise(
      runtime.run(
        makeSpec(),
        {
          chunkText: "biology",
          maxTopics: 3,
        },
        {
          maxAttempts: 2,
        },
      ),
    );

    expect(result.output).toEqual({ topics: ["biology"] });
    expect(result.metadata.attemptCount).toBe(2);
    expect(callCount).toBe(2);
  });

  it("retries once on validation failure then succeeds", async () => {
    let callCount = 0;

    const runtime = makeRuntime(() => {
      callCount += 1;

      if (callCount === 1) {
        return Effect.succeed(makeGenerateResult('{"topics":[1,2,3]}'));
      }

      return Effect.succeed(makeGenerateResult('{"topics":["history"]}'));
    });

    const result = await Effect.runPromise(
      runtime.run(
        makeSpec(),
        {
          chunkText: "history",
          maxTopics: 3,
        },
        {
          maxAttempts: 2,
        },
      ),
    );

    expect(result.output).toEqual({ topics: ["history"] });
    expect(result.metadata.attemptCount).toBe(2);
    expect(callCount).toBe(2);
  });

  it("honors retrySchedule from options", async () => {
    let callCount = 0;

    const runtime = makeRuntime(() => {
      callCount += 1;
      return Effect.succeed(makeGenerateResult("not-json"));
    });

    const exit = await Effect.runPromiseExit(
      runtime.run(
        makeSpec(),
        {
          chunkText: "topic",
          maxTopics: 1,
        },
        {
          retrySchedule: Schedule.recurs(0),
          maxAttempts: 5,
        },
      ),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptOutputParseError);
    expect(callCount).toBe(1);
  });

  it("wraps model invocation errors and does not retry them", async () => {
    let callCount = 0;

    const runtime = makeRuntime(() => {
      callCount += 1;
      return Effect.fail(new AiRateLimitError({ message: "limited", retryAfterMs: 2000 }));
    });

    const exit = await Effect.runPromiseExit(
      runtime.run(makeSpec(), {
        chunkText: "topic",
        maxTopics: 1,
      }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptModelInvocationError);
    if (failure instanceof PromptModelInvocationError) {
      expect(failure.promptId).toBe("forge/test-prompt");
      expect(failure.model).toBe("anthropic/claude-sonnet-4-20250514");
      expect(failure.attempt).toBe(1);
      expect(failure.cause).toBeInstanceOf(AiRateLimitError);
    }
    expect(callCount).toBe(1);
  });

  it("maps input decode failures", async () => {
    const generateText = vi
      .fn<AiClient["generateText"]>()
      .mockImplementation(() => Effect.succeed(makeGenerateResult('{"topics":[]}')));

    const runtime = makeRuntime(generateText);

    const exit = await Effect.runPromiseExit(
      runtime.run(makeSpec(), {
        chunkText: "",
        maxTopics: 2,
      }),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptInputValidationError);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("maps normalization defects", async () => {
    const runtime = makeRuntime(() => Effect.succeed(makeGenerateResult('{"topics":["one"]}')));

    const exit = await Effect.runPromiseExit(
      runtime.run(
        makeSpec({
          normalize: () => {
            throw new Error("normalize failed");
          },
        }),
        {
          chunkText: "text",
          maxTopics: 1,
        },
      ),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptNormalizationError);
  });

  it("computes stable prompt hash for same rendered payload", async () => {
    const runtime = makeRuntime(() => Effect.succeed(makeGenerateResult('{"topics":["x"]}')));

    const first = await Effect.runPromise(
      runtime.run(makeSpec(), {
        chunkText: "same input",
        maxTopics: 2,
      }),
    );

    const second = await Effect.runPromise(
      runtime.run(makeSpec(), {
        chunkText: "same input",
        maxTopics: 2,
      }),
    );

    expect(first.metadata.promptHash).toBe(second.metadata.promptHash);
  });

  it("returns parse error after exhausting retries", async () => {
    let callCount = 0;
    const runtime = makeRuntime(() => {
      callCount += 1;
      return Effect.succeed(makeGenerateResult("not json"));
    });

    const exit = await Effect.runPromiseExit(
      runtime.run(
        makeSpec(),
        {
          chunkText: "topic",
          maxTopics: 1,
        },
        {
          maxAttempts: 2,
        },
      ),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptOutputParseError);
    expect(callCount).toBe(2);
  });

  it("returns validation error after exhausting retries", async () => {
    let callCount = 0;
    const runtime = makeRuntime(() => {
      callCount += 1;
      return Effect.succeed(makeGenerateResult('{"topics":[1]}'));
    });

    const exit = await Effect.runPromiseExit(
      runtime.run(
        makeSpec(),
        {
          chunkText: "topic",
          maxTopics: 1,
        },
        {
          maxAttempts: 2,
        },
      ),
    );
    const failure = getFailure(exit);

    expect(failure).toBeInstanceOf(PromptOutputValidationError);
    expect(callCount).toBe(2);
  });

  it("supports transformed output schemas after normalization without re-decoding", async () => {
    const transformedOutputSchema = Schema.Struct({
      topics: Schema.Array(Schema.NumberFromString),
    });

    type TransformedOutput = typeof transformedOutputSchema.Type;

    const transformedSpec: PromptSpec<TestInput, TransformedOutput> = {
      promptId: "forge/test-prompt",
      displayName: "Test prompt",
      version: "1",
      inputSchema: TestInputSchema,
      outputSchema: transformedOutputSchema as unknown as Schema.Schema<TransformedOutput>,
      defaults: {
        temperature: 0.2,
        maxTokens: 500,
      },
      render: (input) => ({
        systemPrompt: "JSON only",
        messages: [{ role: "user", content: `<source_text>${input.chunkText}</source_text>` }],
      }),
      normalize: (output, input) => ({
        topics: output.topics.slice(0, input.maxTopics),
      }),
    };

    const runtime = makeRuntime(() => Effect.succeed(makeGenerateResult('{"topics":["1","2"]}')));

    const result = await Effect.runPromise(
      runtime.run(transformedSpec, {
        chunkText: "numbers",
        maxTopics: 2,
      }),
    );

    expect(result.output).toEqual({
      topics: [1, 2],
    });
  });
});
