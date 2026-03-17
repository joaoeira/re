import { createContext, useCallback, useContext, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { AiModelDefinition } from "@shared/ai-models";
import { createSecretKeyRecord, type SecretKey } from "@shared/secrets";
import { useApiKeyMutations } from "@/hooks/mutations/use-api-key-mutations";
import { useDefaultModelMutation } from "@/hooks/mutations/use-default-model-mutation";
import { useWorkspaceRootMutations } from "@/hooks/mutations/use-workspace-root-mutations";
import { useAiModelsQuery } from "@/hooks/queries/use-ai-models-query";
import { useApiKeysConfiguredQuery } from "@/hooks/queries/use-api-keys-configured-query";
import { useSettingsQuery } from "@/hooks/queries/use-settings-query";
import { queryKeys } from "@/lib/query-keys";
import type { ApiKeyState } from "./provider-key-row";

type SettingsPageActions = {
  readonly reload: () => void;
  readonly selectDirectory: () => void;
  readonly clearRootPath: () => void;
  readonly saveKey: (key: SecretKey, value: string) => void;
  readonly removeKey: (key: SecretKey) => void;
  readonly setDefaultModelKey: (modelKey: string | null) => void;
};

type SettingsPageState = {
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly rootPath: string | null;
  readonly rootPathSaving: boolean;
  readonly rootPathError: string | null;
  readonly apiKeys: Record<SecretKey, ApiKeyState>;
  readonly defaultModelKey: string | null;
  readonly defaultModelSaving: boolean;
  readonly defaultModelError: string | null;
  readonly aiModels: readonly AiModelDefinition[];
  readonly applicationDefaultModelKey: string | null;
  readonly modelsLoading: boolean;
  readonly modelsLoadError: string | null;
};

type SettingsPageContextValue = {
  readonly state: SettingsPageState;
  readonly actions: SettingsPageActions;
};

const SettingsPageContext = createContext<SettingsPageContextValue | null>(null);

function useSettingsPageContextValue(): SettingsPageContextValue {
  const context = useContext(SettingsPageContext);
  if (!context) throw new Error("SettingsPageProvider is missing from the component tree");
  return context;
}

export function useSettingsPageState(): SettingsPageState {
  return useSettingsPageContextValue().state;
}

export function useSettingsPageActions(): SettingsPageActions {
  return useSettingsPageContextValue().actions;
}

export function SettingsPageProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const apiKeysConfiguredQuery = useApiKeysConfiguredQuery();

  const {
    rootPathSaving,
    rootPathError,
    selectDirectory,
    clearRootPath,
    clearError: clearRootPathError,
  } = useWorkspaceRootMutations();
  const {
    saving: apiKeySaving,
    errors: apiKeyErrors,
    saveKey,
    removeKey,
    clearErrors: clearApiKeyErrors,
  } = useApiKeyMutations();
  const aiModelsQuery = useAiModelsQuery();
  const {
    saving: defaultModelSaving,
    error: defaultModelError,
    setDefaultModelKey,
    clearError: clearDefaultModelError,
  } = useDefaultModelMutation();

  const reload = useCallback(() => {
    clearRootPathError();
    clearApiKeyErrors();
    clearDefaultModelError();
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeysConfigured });
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiModels });
  }, [clearApiKeyErrors, clearDefaultModelError, clearRootPathError, queryClient]);

  const loadError = (() => {
    if (settingsQuery.error) {
      return `Failed to load settings: ${settingsQuery.error.message}`;
    }

    if (apiKeysConfiguredQuery.error) {
      return `Failed to load settings: ${apiKeysConfiguredQuery.error.message}`;
    }

    return null;
  })();

  const modelsLoadError = aiModelsQuery.error
    ? `Failed to load models: ${aiModelsQuery.error.message}`
    : null;

  const configuredByKey = apiKeysConfiguredQuery.data ?? createSecretKeyRecord(() => false);

  const state = useMemo<SettingsPageState>(
    () => ({
      loading: settingsQuery.isPending || apiKeysConfiguredQuery.isPending,
      loadError,
      rootPath: settingsQuery.data?.workspace.rootPath ?? null,
      rootPathSaving,
      rootPathError,
      apiKeys: createSecretKeyRecord((key) => ({
        configured: configuredByKey[key],
        saving: apiKeySaving[key],
        error: apiKeyErrors[key],
      })),
      defaultModelKey: settingsQuery.data?.ai.defaultModelKey ?? null,
      defaultModelSaving,
      defaultModelError,
      aiModels: aiModelsQuery.data?.models ?? [],
      applicationDefaultModelKey: aiModelsQuery.data?.applicationDefaultModelKey ?? null,
      modelsLoading: aiModelsQuery.isPending,
      modelsLoadError,
    }),
    [
      settingsQuery.isPending,
      apiKeysConfiguredQuery.isPending,
      loadError,
      settingsQuery.data,
      rootPathSaving,
      rootPathError,
      configuredByKey,
      apiKeySaving,
      apiKeyErrors,
      defaultModelSaving,
      defaultModelError,
      aiModelsQuery.data,
      aiModelsQuery.isPending,
      modelsLoadError,
    ],
  );

  const actions = useMemo(
    () => ({
      reload,
      selectDirectory,
      clearRootPath,
      saveKey,
      removeKey,
      setDefaultModelKey,
    }),
    [reload, selectDirectory, clearRootPath, saveKey, removeKey, setDefaultModelKey],
  );

  const value = useMemo(
    () => ({
      state,
      actions,
    }),
    [state, actions],
  );

  return <SettingsPageContext.Provider value={value}>{children}</SettingsPageContext.Provider>;
}
