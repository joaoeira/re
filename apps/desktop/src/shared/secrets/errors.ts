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

export const toSecretStoreErrorMessage = (error: SecretStoreError): string => {
  switch (error._tag) {
    case "SecretNotFound":
      return `Key not found: ${error.key}`;
    case "SecretStoreUnavailable":
      return error.message;
    case "SecretDecryptionFailed":
      return `Unable to decrypt ${error.key}: ${error.message}`;
    case "SecretStoreReadFailed":
      return `Unable to read secret store at ${error.path}: ${error.message}`;
    case "SecretStoreWriteFailed":
      return `Unable to write secret store at ${error.path}: ${error.message}`;
  }
};

export const mapSecretStoreErrorToError = (error: SecretStoreError | Error): Error =>
  "_tag" in error ? new Error(toSecretStoreErrorMessage(error)) : error;
