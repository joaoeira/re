import { Context, Layer } from "effect";

import { makeAiClient, type AiClient } from "@main/ai/ai-client";
import type { SecretStore } from "@main/secrets/secret-store";

export const AiClientService = Context.GenericTag<AiClient>(
  "@re/desktop/main/AiClientService",
);

export const AiClientServiceLive = (aiService: AiClient) =>
  Layer.succeed(AiClientService, aiService);

export const AiClientServiceFromSecretStoreLive = (secretStore: SecretStore) =>
  AiClientServiceLive(makeAiClient({ secretStore }));
