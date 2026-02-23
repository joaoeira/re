import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, type LanguageModelV3 } from "@ai-sdk/provider";
import { Effect, Stream } from "effect";

import type { SecretStore } from "@main/secrets/secret-store";
import type { SecretKey } from "@shared/secrets";
import {
  AiCompletionError,
  AiKeyMissingError,
  AiOfflineError,
  AiProviderNotSupportedError,
  AiRateLimitError,
  type AiStreamError,
} from "@shared/rpc/schemas/ai";

interface ProviderConfig {
  readonly secretKey: SecretKey;
  readonly createModel: (apiKey: string, modelId: string) => LanguageModelV3;
}

const providers = {
  anthropic: {
    secretKey: "anthropic-api-key",
    createModel: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  },
  openai: {
    secretKey: "openai-api-key",
    createModel: (apiKey, modelId) => createOpenAI({ apiKey })(modelId),
  },
} satisfies Record<string, ProviderConfig>;

const hasProvider = (providerId: string): providerId is keyof typeof providers =>
  Object.hasOwn(providers, providerId);

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const retryAfterMs = (
  headers?: Readonly<Record<string, string | undefined>>,
): number | undefined => {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }

  return seconds * 1000;
};

export interface AiClient {
  readonly streamCompletion: (input: {
    readonly model: string;
    readonly prompt: string;
    readonly systemPrompt?: string | undefined;
  }) => Stream.Stream<string, AiStreamError>;
}

export interface MakeAiClientOptions {
  readonly secretStore: SecretStore;
}

export const makeAiClient = ({ secretStore }: MakeAiClientOptions): AiClient => ({
  streamCompletion: ({ model, prompt, systemPrompt }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const colonIndex = model.indexOf(":");

        if (colonIndex === -1) {
          return yield* Effect.fail(new AiProviderNotSupportedError({ model }));
        }

        const providerId = model.slice(0, colonIndex);
        const modelId = model.slice(colonIndex + 1);

        if (!hasProvider(providerId)) {
          return yield* Effect.fail(new AiProviderNotSupportedError({ model }));
        }
        const config = providers[providerId];

        const apiKey = yield* secretStore.getSecret(config.secretKey).pipe(
          Effect.catchTag("SecretNotFound", () =>
            Effect.fail(new AiKeyMissingError({ key: config.secretKey })),
          ),
          Effect.catchTags({
            SecretStoreUnavailable: (e) =>
              Effect.fail(new AiCompletionError({ message: e.message })),
            SecretDecryptionFailed: (e) =>
              Effect.fail(new AiCompletionError({ message: e.message })),
            SecretStoreReadFailed: (e) =>
              Effect.fail(new AiCompletionError({ message: e.message })),
          }),
        );

        const controller = new AbortController();
        const languageModel = config.createModel(apiKey, modelId);

        return Stream.asyncPush<string, AiCompletionError | AiRateLimitError | AiOfflineError>(
          (emit) =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));

              (async () => {
                try {
                  const result = streamText({
                    model: languageModel,
                    prompt,
                    ...(systemPrompt !== undefined ? { system: systemPrompt } : {}),
                    abortSignal: controller.signal,
                  });

                  for await (const delta of result.textStream) {
                    const accepted = emit.single(delta);
                    if (!accepted) {
                      break;
                    }
                  }

                  emit.end();
                } catch (error) {
                  if (controller.signal.aborted) {
                    return;
                  }

                  if (APICallError.isInstance(error) && error.statusCode === 429) {
                    emit.fail(
                      new AiRateLimitError({
                        message: error.message,
                        retryAfterMs: retryAfterMs(error.responseHeaders),
                      }),
                    );
                    return;
                  }

                  if (error instanceof TypeError) {
                    emit.fail(new AiOfflineError({ message: "Network request failed." }));
                    return;
                  }

                  emit.fail(new AiCompletionError({ message: toMessage(error) }));
                }
              })();
            }),
        );
      }),
    ),
});
