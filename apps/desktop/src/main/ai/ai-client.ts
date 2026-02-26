import { generateText, streamText } from "ai";
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
  type AiGenerateCompletionError,
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

type AiProviderResolutionError =
  | AiCompletionError
  | AiKeyMissingError
  | AiProviderNotSupportedError;

type AiProviderInvocationError = AiCompletionError | AiRateLimitError | AiOfflineError;

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

const mapProviderInvocationError = (error: unknown): AiProviderInvocationError => {
  if (APICallError.isInstance(error) && error.statusCode === 429) {
    return new AiRateLimitError({
      message: error.message,
      retryAfterMs: retryAfterMs(error.responseHeaders),
    });
  }

  if (error instanceof TypeError) {
    return new AiOfflineError({ message: "Network request failed." });
  }

  return new AiCompletionError({ message: toMessage(error) });
};

const resolveProvider = (
  model: string,
): Effect.Effect<
  {
    readonly config: ProviderConfig;
    readonly modelId: string;
  },
  AiProviderNotSupportedError
> => {
  const colonIndex = model.indexOf(":");

  if (colonIndex === -1) {
    return Effect.fail(new AiProviderNotSupportedError({ model }));
  }

  const providerId = model.slice(0, colonIndex);
  const modelId = model.slice(colonIndex + 1);

  if (!hasProvider(providerId)) {
    return Effect.fail(new AiProviderNotSupportedError({ model }));
  }

  return Effect.succeed({ config: providers[providerId], modelId });
};

const loadProviderApiKey = (
  secretStore: SecretStore,
  secretKey: SecretKey,
): Effect.Effect<string, AiCompletionError | AiKeyMissingError> =>
  secretStore.getSecret(secretKey).pipe(
    Effect.catchTag("SecretNotFound", () => Effect.fail(new AiKeyMissingError({ key: secretKey }))),
    Effect.catchTags({
      SecretStoreUnavailable: (error) =>
        Effect.fail(new AiCompletionError({ message: error.message })),
      SecretDecryptionFailed: (error) =>
        Effect.fail(new AiCompletionError({ message: error.message })),
      SecretStoreReadFailed: (error) =>
        Effect.fail(new AiCompletionError({ message: error.message })),
    }),
  );

const resolveLanguageModel = (
  secretStore: SecretStore,
  model: string,
): Effect.Effect<LanguageModelV3, AiProviderResolutionError> =>
  Effect.gen(function* () {
    const { config, modelId } = yield* resolveProvider(model);
    const apiKey = yield* loadProviderApiKey(secretStore, config.secretKey);
    return config.createModel(apiKey, modelId);
  });

export interface AiClient {
  readonly generateCompletion: (input: {
    readonly model: string;
    readonly prompt: string;
    readonly systemPrompt?: string | undefined;
    readonly temperature?: number | undefined;
    readonly maxTokens?: number | undefined;
  }) => Effect.Effect<string, AiGenerateCompletionError>;
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
  generateCompletion: ({ model, prompt, systemPrompt, temperature, maxTokens }) =>
    Effect.gen(function* () {
      const languageModel = yield* resolveLanguageModel(secretStore, model);

      const result = yield* Effect.tryPromise({
        try: (abortSignal) =>
          generateText({
            model: languageModel,
            prompt,
            ...(systemPrompt !== undefined ? { system: systemPrompt } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
            abortSignal,
          }),
        catch: mapProviderInvocationError,
      });

      return result.text;
    }),
  streamCompletion: ({ model, prompt, systemPrompt }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const controller = new AbortController();
        const languageModel = yield* resolveLanguageModel(secretStore, model);

        return Stream.asyncPush<string, AiProviderInvocationError>(
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

                  emit.fail(mapProviderInvocationError(error));
                }
              })();
            }),
        );
      }),
    ),
});
