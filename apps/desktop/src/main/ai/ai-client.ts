import { RetryError, generateText, streamText, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, type LanguageModelV3 } from "@ai-sdk/provider";
import { Effect, Stream } from "effect";

import type { SecretStore } from "@main/secrets/secret-store";
import type { SecretKey } from "@shared/secrets";
import {
  type AiMessage,
  AiCompletionError,
  type AiGenerateTextResult,
  AiKeyMissingError,
  AiOfflineError,
  AiProviderNotSupportedError,
  AiRateLimitError,
  type AiGenerateTextError,
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

const unwrapRetryError = (error: unknown): unknown => {
  let current = error;

  while (RetryError.isInstance(current) && current.lastError !== current) {
    current = current.lastError;
  }

  return current;
};

const mapProviderInvocationError = (error: unknown): AiProviderInvocationError => {
  const sourceError = unwrapRetryError(error);

  if (APICallError.isInstance(sourceError) && sourceError.statusCode === 429) {
    return new AiRateLimitError({
      message: sourceError.message,
      retryAfterMs: retryAfterMs(sourceError.responseHeaders),
    });
  }

  if (sourceError instanceof TypeError) {
    return new AiOfflineError({ message: "Network request failed." });
  }

  return new AiCompletionError({ message: toMessage(sourceError) });
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

export interface AiGenerateTextInput {
  readonly model: string;
  readonly messages: ReadonlyArray<AiMessage>;
  readonly systemPrompt?: string | undefined;
  readonly temperature?: number | undefined;
  readonly maxTokens?: number | undefined;
  readonly maxRetries?: number | undefined;
}

export interface AiClient {
  readonly generateText: (
    input: AiGenerateTextInput,
  ) => Effect.Effect<AiGenerateTextResult, AiGenerateTextError>;
  readonly streamText: (input: AiGenerateTextInput) => Stream.Stream<string, AiStreamError>;
}

export interface MakeAiClientOptions {
  readonly secretStore: SecretStore;
}

const mapMessagesToAiSdk = (messages: ReadonlyArray<AiMessage>): Array<ModelMessage> =>
  messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ({ type: "text", text: part.text })),
  }));

const ensureNonEmptyMessages = (
  messages: ReadonlyArray<AiMessage>,
): Effect.Effect<void, AiCompletionError> =>
  messages.length === 0
    ? Effect.fail(new AiCompletionError({ message: "messages must contain at least one entry." }))
    : Effect.void;

export const makeAiClient = ({ secretStore }: MakeAiClientOptions): AiClient => ({
  generateText: ({ model, messages, systemPrompt, temperature, maxTokens, maxRetries }) =>
    Effect.gen(function* () {
      yield* ensureNonEmptyMessages(messages);
      const languageModel = yield* resolveLanguageModel(secretStore, model);
      const modelMessages = mapMessagesToAiSdk(messages);
      const resolvedMaxRetries = maxRetries ?? 0;

      const result = yield* Effect.tryPromise({
        try: (abortSignal) =>
          generateText({
            model: languageModel,
            messages: modelMessages,
            ...(systemPrompt !== undefined ? { system: systemPrompt } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
            maxRetries: resolvedMaxRetries,
            abortSignal,
          }),
        catch: mapProviderInvocationError,
      });

      return {
        text: result.text,
        finishReason: result.finishReason,
        model: result.response.modelId,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens,
          cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens,
        },
      };
    }),
  streamText: ({ model, messages, systemPrompt, temperature, maxTokens, maxRetries }) =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* ensureNonEmptyMessages(messages);
        const controller = new AbortController();
        const languageModel = yield* resolveLanguageModel(secretStore, model);
        const modelMessages = mapMessagesToAiSdk(messages);
        const resolvedMaxRetries = maxRetries ?? 0;

        return Stream.asyncPush<string, AiProviderInvocationError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));

            (async () => {
              try {
                const result = streamText({
                  model: languageModel,
                  messages: modelMessages,
                  ...(systemPrompt !== undefined ? { system: systemPrompt } : {}),
                  ...(temperature !== undefined ? { temperature } : {}),
                  ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
                  maxRetries: resolvedMaxRetries,
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
