import { Schema } from "@effect/schema";

import { SecretKeySchema } from "./keys";

export class SecretNotFound extends Schema.TaggedError<SecretNotFound>(
  "@re/desktop/secrets/SecretNotFound",
)("SecretNotFound", {
  key: SecretKeySchema,
}) {}

export class SecretStoreUnavailable extends Schema.TaggedError<SecretStoreUnavailable>(
  "@re/desktop/secrets/SecretStoreUnavailable",
)("SecretStoreUnavailable", {
  message: Schema.String,
}) {}

export class SecretDecryptionFailed extends Schema.TaggedError<SecretDecryptionFailed>(
  "@re/desktop/secrets/SecretDecryptionFailed",
)("SecretDecryptionFailed", {
  key: SecretKeySchema,
  message: Schema.String,
}) {}

export class SecretStoreReadFailed extends Schema.TaggedError<SecretStoreReadFailed>(
  "@re/desktop/secrets/SecretStoreReadFailed",
)("SecretStoreReadFailed", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class SecretStoreWriteFailed extends Schema.TaggedError<SecretStoreWriteFailed>(
  "@re/desktop/secrets/SecretStoreWriteFailed",
)("SecretStoreWriteFailed", {
  path: Schema.String,
  message: Schema.String,
}) {}

export const SecretStoreErrorSchema = Schema.Union(
  SecretNotFound,
  SecretStoreUnavailable,
  SecretDecryptionFailed,
  SecretStoreReadFailed,
  SecretStoreWriteFailed,
);

export type SecretStoreError = typeof SecretStoreErrorSchema.Type;
