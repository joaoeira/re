import { createContext, useCallback, useContext, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createSecretKeyRecord, type SecretKey } from "@shared/secrets";
import { useApiKeyMutations } from "@/hooks/mutations/use-api-key-mutations";
import { useWorkspaceRootMutations } from "@/hooks/mutations/use-workspace-root-mutations";
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
};

type SettingsPageState = {
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly rootPath: string | null;
  readonly rootPathSaving: boolean;
  readonly rootPathError: string | null;
  readonly apiKeys: Record<SecretKey, ApiKeyState>;
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

  const reload = useCallback(() => {
    clearRootPathError();
    clearApiKeyErrors();
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeysConfigured });
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiModels });
    void queryClient.invalidateQueries({ queryKey: queryKeys.promptTasks });
  }, [clearApiKeyErrors, clearRootPathError, queryClient]);

  const loadError = (() => {
    if (settingsQuery.error) {
      return `Failed to load settings: ${settingsQuery.error.message}`;
    }

    if (apiKeysConfiguredQuery.error) {
      return `Failed to load settings: ${apiKeysConfiguredQuery.error.message}`;
    }

    return null;
  })();

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
    ],
  );

  const actions = useMemo(
    () => ({
      reload,
      selectDirectory,
      clearRootPath,
      saveKey,
      removeKey,
    }),
    [reload, selectDirectory, clearRootPath, saveKey, removeKey],
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
