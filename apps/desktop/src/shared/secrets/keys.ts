import { Schema } from "@effect/schema";

export const SecretKeySchema = Schema.Literal(
  "openai-api-key",
  "anthropic-api-key",
  "gemini-api-key",
);

export type SecretKey = typeof SecretKeySchema.Type;
