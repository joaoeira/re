import { Context, Layer } from "effect";

import type { SecretStore } from "@main/secrets/secret-store";

export const SecretStoreService = Context.GenericTag<SecretStore>(
  "@re/desktop/main/SecretStoreService",
);

export const SecretStoreServiceLive = (secretStore: SecretStore) =>
  Layer.succeed(SecretStoreService, secretStore);
