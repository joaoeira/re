import { createStore } from "@xstate/store";

import type { SecretKey } from "@shared/secrets";
import type { ApiKeyState } from "./provider-key-row";

const createDefaultApiKeyState = (): ApiKeyState => ({
  configured: false,
  saving: false,
  error: null,
});

const createDefaultApiKeys = (): Record<SecretKey, ApiKeyState> => ({
  "openai-api-key": createDefaultApiKeyState(),
  "anthropic-api-key": createDefaultApiKeyState(),
});

const updateApiKey = (
  apiKeys: Record<SecretKey, ApiKeyState>,
  key: SecretKey,
  next: Partial<ApiKeyState>,
): Record<SecretKey, ApiKeyState> => ({
  ...apiKeys,
  [key]: {
    ...apiKeys[key],
    ...next,
  },
});

export const createSettingsPageStore = () =>
  createStore({
    context: {
      loading: false,
      loadError: null as string | null,
      rootPath: null as string | null,
      rootPathSaving: false,
      rootPathError: null as string | null,
      apiKeys: createDefaultApiKeys(),
    },
    on: {
      setLoading: (context) => ({
        ...context,
        loading: true,
        loadError: null,
        rootPathError: null,
      }),
      loadSuccess: (
        context,
        event: {
          rootPath: string | null;
          openaiConfigured: boolean;
          anthropicConfigured: boolean;
        },
      ) => ({
        ...context,
        loading: false,
        loadError: null,
        rootPath: event.rootPath,
        apiKeys: {
          "openai-api-key": {
            configured: event.openaiConfigured,
            saving: false,
            error: null,
          },
          "anthropic-api-key": {
            configured: event.anthropicConfigured,
            saving: false,
            error: null,
          },
        },
      }),
      loadError: (context, event: { error: string }) => ({
        ...context,
        loading: false,
        loadError: event.error,
      }),
      setRootPathSaving: (context) => ({
        ...context,
        rootPathSaving: true,
        rootPathError: null,
      }),
      rootPathSaved: (context, event: { rootPath: string | null }) => ({
        ...context,
        rootPath: event.rootPath,
        rootPathSaving: false,
      }),
      rootPathSaveError: (context, event: { error: string }) => ({
        ...context,
        rootPathSaving: false,
        rootPathError: event.error,
      }),
      setApiKeySaving: (context, event: { key: SecretKey }) => ({
        ...context,
        apiKeys: updateApiKey(context.apiKeys, event.key, {
          saving: true,
          error: null,
        }),
      }),
      apiKeySaved: (context, event: { key: SecretKey; configured: boolean }) => ({
        ...context,
        apiKeys: updateApiKey(context.apiKeys, event.key, {
          configured: event.configured,
          saving: false,
          error: null,
        }),
      }),
      apiKeySaveError: (context, event: { key: SecretKey; error: string }) => ({
        ...context,
        apiKeys: updateApiKey(context.apiKeys, event.key, {
          saving: false,
          error: event.error,
        }),
      }),
    },
  });

export type SettingsPageStore = ReturnType<typeof createSettingsPageStore>;
