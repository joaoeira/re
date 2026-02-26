import { Data } from "effect";

import type { AiGenerateTextError } from "@shared/rpc/schemas/ai";

export class PromptInputValidationError extends Data.TaggedError("PromptInputValidationError")<{
  readonly promptId: string;
  readonly message: string;
}> {}

export class PromptOutputParseError extends Data.TaggedError("PromptOutputParseError")<{
  readonly promptId: string;
  readonly message: string;
  readonly rawExcerpt: string;
}> {}

export class PromptOutputValidationError extends Data.TaggedError("PromptOutputValidationError")<{
  readonly promptId: string;
  readonly message: string;
  readonly rawExcerpt: string;
}> {}

export class PromptNormalizationError extends Data.TaggedError("PromptNormalizationError")<{
  readonly promptId: string;
  readonly message: string;
}> {}

export class PromptModelInvocationError extends Data.TaggedError("PromptModelInvocationError")<{
  readonly promptId: string;
  readonly model: string;
  readonly attempt: number;
  readonly cause: AiGenerateTextError;
}> {}

export type PromptRuntimeError =
  | PromptInputValidationError
  | PromptOutputParseError
  | PromptOutputValidationError
  | PromptNormalizationError
  | PromptModelInvocationError;
