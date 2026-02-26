import { createHash } from "node:crypto";

import { Schema } from "@effect/schema";
import { Context, Data, Effect, Schedule } from "effect";

import type { AiClient } from "@main/ai/ai-client";
import { toErrorMessage } from "@main/utils/format";

import { decodeJsonToSchema } from "../prompts";
import {
  PromptInputValidationError,
  PromptModelInvocationError,
  PromptNormalizationError,
  type PromptOutputParseError,
  type PromptOutputValidationError,
  type PromptRuntimeError,
} from "../prompts/errors";
import type {
  PromptAttemptContext,
  PromptRunOptions,
  PromptRunResult,
  PromptSpec,
} from "../prompts/types";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, canonicalize(entryValue)] as const);
    return Object.fromEntries(entries);
  }

  return value;
};

const computePromptHash = (payload: {
  readonly promptId: string;
  readonly promptVersion: string;
  readonly systemPrompt?: string | undefined;
  readonly messages: ReadonlyArray<unknown>;
}): string => {
  const canonicalPayload = canonicalize({
    promptId: payload.promptId,
    promptVersion: payload.promptVersion,
    systemPrompt: payload.systemPrompt ?? null,
    messages: payload.messages,
  });

  return createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
};

export interface ForgePromptRuntime {
  readonly run: <Input, Output>(
    spec: PromptSpec<Input, Output>,
    input: Input,
    options?: PromptRunOptions,
  ) => Effect.Effect<PromptRunResult<Output>, PromptRuntimeError>;
}

export const ForgePromptRuntime = Context.GenericTag<ForgePromptRuntime>(
  "@re/desktop/main/ForgePromptRuntime",
);

export interface MakeForgePromptRuntimeOptions {
  readonly aiClient: AiClient;
}

type RetryablePromptOutputError = PromptOutputParseError | PromptOutputValidationError;

class RetryablePromptAttemptFailure extends Data.TaggedError("RetryablePromptAttemptFailure")<{
  readonly error: RetryablePromptOutputError;
  readonly context: PromptAttemptContext;
  readonly promptHash: string;
  readonly outputChars: number;
}> {}

class TerminalPromptAttemptFailure extends Data.TaggedError("TerminalPromptAttemptFailure")<{
  readonly error: PromptRuntimeError;
  readonly attempt: number;
  readonly promptHash: string;
  readonly outputChars: number;
}> {}

const toDefaultRetrySchedule = (maxAttempts: number): Schedule.Schedule<unknown> =>
  Schedule.recurs(Math.max(0, maxAttempts - 1));

const toRetryContext = (
  context: PromptAttemptContext,
  error: RetryablePromptOutputError,
): PromptAttemptContext => ({
  attempt: context.attempt + 1,
  previousErrorTag: error._tag,
  previousRawExcerpt: error.rawExcerpt,
});

export const makeForgePromptRuntime = ({
  aiClient,
}: MakeForgePromptRuntimeOptions): ForgePromptRuntime => ({
  run: <Input, Output>(spec: PromptSpec<Input, Output>, input: Input, options?: PromptRunOptions) =>
    Effect.gen(function* () {
      const decodedInput = yield* Schema.decodeUnknown(spec.inputSchema)(input).pipe(
        Effect.mapError(
          (error) =>
            new PromptInputValidationError({
              promptId: spec.promptId,
              message: `Prompt input failed schema validation: ${toErrorMessage(error)}`,
            }),
        ),
      );

      const model = options?.model ?? spec.defaults.model;
      const temperature = options?.temperature ?? spec.defaults.temperature;
      const maxTokens = options?.maxTokens ?? spec.defaults.maxTokens;
      const maxAttempts = Math.max(1, options?.maxAttempts ?? 2);
      const retrySchedule = options?.retrySchedule ?? toDefaultRetrySchedule(maxAttempts);
      const retryDriver = yield* Schedule.driver(retrySchedule);

      const executeAttempt = (
        context: PromptAttemptContext,
      ): Effect.Effect<
        PromptRunResult<Output>,
        RetryablePromptAttemptFailure | TerminalPromptAttemptFailure
      > =>
        Effect.gen(function* () {
          const rendered = spec.render(decodedInput, context);
          const promptHash = computePromptHash({
            promptId: spec.promptId,
            promptVersion: spec.version,
            systemPrompt: rendered.systemPrompt,
            messages: rendered.messages,
          });

          const completion = yield* aiClient
            .generateText({
              model,
              messages: rendered.messages,
              systemPrompt: rendered.systemPrompt,
              temperature,
              maxTokens,
              maxRetries: 0,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new TerminalPromptAttemptFailure({
                    error: new PromptModelInvocationError({
                      promptId: spec.promptId,
                      model,
                      attempt: context.attempt,
                      cause,
                    }),
                    attempt: context.attempt,
                    promptHash,
                    outputChars: 0,
                  }),
              ),
            );

          const rawText = completion.text;
          const outputChars = rawText.length;

          const decodedOutput = yield* decodeJsonToSchema(
            spec.outputSchema,
            rawText,
            spec.promptId,
          ).pipe(
            Effect.catchTags({
              PromptOutputParseError: (error) =>
                Effect.fail(
                  new RetryablePromptAttemptFailure({
                    error,
                    context,
                    promptHash,
                    outputChars,
                  }),
                ),
              PromptOutputValidationError: (error) =>
                Effect.fail(
                  new RetryablePromptAttemptFailure({
                    error,
                    context,
                    promptHash,
                    outputChars,
                  }),
                ),
            }),
          );

          const normalizedOutput = yield* Effect.try({
            try: () => spec.normalize(decodedOutput, decodedInput),
            catch: (error) =>
              new PromptNormalizationError({
                promptId: spec.promptId,
                message: `Prompt output normalization failed: ${toErrorMessage(error)}`,
              }),
          }).pipe(
            Effect.mapError(
              (error) =>
                new TerminalPromptAttemptFailure({
                  error,
                  attempt: context.attempt,
                  promptHash,
                  outputChars,
                }),
            ),
          );

          return {
            output: normalizedOutput,
            rawText,
            metadata: {
              promptId: spec.promptId,
              promptVersion: spec.version,
              model,
              attemptCount: context.attempt,
              promptHash,
              outputChars,
            },
          };
        });

      const executeWithRetries = (
        context: PromptAttemptContext,
      ): Effect.Effect<PromptRunResult<Output>, TerminalPromptAttemptFailure> =>
        executeAttempt(context).pipe(
          Effect.catchTag("RetryablePromptAttemptFailure", (failure) =>
            retryDriver.next(failure.error).pipe(
              Effect.mapError(
                () =>
                  new TerminalPromptAttemptFailure({
                    error: failure.error,
                    attempt: failure.context.attempt,
                    promptHash: failure.promptHash,
                    outputChars: failure.outputChars,
                  }),
              ),
              Effect.flatMap(() =>
                executeWithRetries(toRetryContext(failure.context, failure.error)),
              ),
            ),
          ),
        );

      return yield* executeWithRetries({ attempt: 1 }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            console.log("[forge/prompt-runtime]", {
              promptId: result.metadata.promptId,
              promptVersion: result.metadata.promptVersion,
              model: result.metadata.model,
              attempts: result.metadata.attemptCount,
              promptHash: result.metadata.promptHash,
              outputChars: result.metadata.outputChars,
              outcome: "success",
            });
          }),
        ),
        Effect.catchTag("TerminalPromptAttemptFailure", (failure) =>
          Effect.sync(() => {
            console.log("[forge/prompt-runtime]", {
              promptId: spec.promptId,
              promptVersion: spec.version,
              model,
              attempts: failure.attempt,
              promptHash: failure.promptHash,
              outputChars: failure.outputChars,
              outcome: "failure",
              errorTag: failure.error._tag,
            });
          }).pipe(Effect.zipRight(Effect.fail(failure.error))),
        ),
      );
    }),
});
