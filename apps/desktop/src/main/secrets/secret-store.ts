import { Effect } from "effect";

import type {
  SecretDecryptionFailed,
  SecretNotFound,
  SecretStoreReadFailed,
  SecretStoreUnavailable,
  SecretStoreWriteFailed,
} from "@shared/secrets";
import type { SecretKey } from "@shared/secrets";

export interface SecretStore {
  readonly getSecret: (
    key: SecretKey,
  ) => Effect.Effect<
    string,
    SecretNotFound | SecretStoreUnavailable | SecretDecryptionFailed | SecretStoreReadFailed
  >;

  readonly setSecret: (
    key: SecretKey,
    value: string,
  ) => Effect.Effect<void, SecretStoreUnavailable | SecretStoreReadFailed | SecretStoreWriteFailed>;

  readonly deleteSecret: (
    key: SecretKey,
  ) => Effect.Effect<void, SecretStoreUnavailable | SecretStoreReadFailed | SecretStoreWriteFailed>;

  readonly hasSecret: (
    key: SecretKey,
  ) => Effect.Effect<boolean, SecretStoreUnavailable | SecretStoreReadFailed>;
}
