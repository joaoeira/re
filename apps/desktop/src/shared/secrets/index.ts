export { SecretKeySchema, type SecretKey } from "./keys";

export {
  SecretDecryptionFailed,
  SecretNotFound,
  SecretStoreErrorSchema,
  SecretStoreReadFailed,
  SecretStoreUnavailable,
  SecretStoreWriteFailed,
  mapSecretStoreErrorToError,
  toSecretStoreErrorMessage,
  type SecretStoreError,
} from "./errors";
