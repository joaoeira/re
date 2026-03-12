import { Schema } from "@effect/schema";

export const SECRET_KEYS = [
  "openai-api-key",
  "anthropic-api-key",
  "gemini-api-key",
  "openrouter-api-key",
] as const;

export const SecretKeySchema = Schema.Literal(...SECRET_KEYS);

export type SecretKey = typeof SecretKeySchema.Type;

export const createSecretKeyRecord = <T>(
  createValue: (key: SecretKey) => T,
): Record<SecretKey, T> =>
  Object.fromEntries(SECRET_KEYS.map((key) => [key, createValue(key)])) as Record<SecretKey, T>;
