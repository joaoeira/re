import { Schema } from "@effect/schema";
import { rpc, streamRpc } from "electron-effect-rpc/contract";

import {
  AiGenerateCompletionErrorSchema,
  AiStreamChunkSchema,
  AiStreamErrorSchema,
  ModelIdSchema,
} from "@shared/rpc/schemas/ai";

export const StreamCompletion = streamRpc(
  "StreamCompletion",
  Schema.Struct({
    model: ModelIdSchema,
    prompt: Schema.String,
    systemPrompt: Schema.optional(Schema.String),
  }),
  AiStreamChunkSchema,
  AiStreamErrorSchema,
);

export const GenerateCompletion = rpc(
  "GenerateCompletion",
  Schema.Struct({
    model: ModelIdSchema,
    prompt: Schema.String,
    systemPrompt: Schema.optional(Schema.String),
    temperature: Schema.optional(Schema.Number.pipe(Schema.nonNegative())),
    maxTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
  }),
  Schema.Struct({
    text: Schema.String,
  }),
  AiGenerateCompletionErrorSchema,
);
