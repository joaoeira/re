import { Schema } from "@effect/schema";
import type * as Schedule from "effect/Schedule";

import type { AiMessage } from "@shared/rpc/schemas/ai";

import type { PromptOutputParseError, PromptOutputValidationError } from "./errors";

export interface PromptRendered {
  readonly systemPrompt?: string;
  readonly messages: ReadonlyArray<AiMessage>;
}

export interface PromptDefaults {
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export type PromptAttemptErrorTag = "PromptOutputParseError" | "PromptOutputValidationError";

export interface PromptAttemptContext {
  readonly attempt: number;
  readonly previousErrorTag?: PromptAttemptErrorTag;
  readonly previousRawExcerpt?: string;
}

export interface PromptSpec<Input, Output> {
  readonly promptId: string;
  readonly displayName: string;
  readonly version: string;
  readonly inputSchema: Schema.Schema<Input>;
  readonly outputSchema: Schema.Schema<Output>;
  readonly defaults: PromptDefaults;
  readonly render: (input: Input, context?: PromptAttemptContext) => PromptRendered;
  readonly normalize: (output: Output, input: Input) => Output;
}

export interface PromptRunOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly maxAttempts?: number;
  readonly retrySchedule?: Schedule.Schedule<
    unknown,
    PromptOutputParseError | PromptOutputValidationError
  >;
}

export interface PromptRunResult<Output> {
  readonly output: Output;
  readonly rawText: string;
  readonly metadata: {
    readonly promptId: string;
    readonly promptVersion: string;
    readonly model: string;
    readonly attemptCount: number;
    readonly promptHash: string;
    readonly outputChars: number;
  };
}
