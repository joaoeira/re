import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useSelector } from "@xstate/store-react";
import { Effect } from "effect";

import type { SecretKey } from "@shared/secrets";
import { useIpc } from "@/lib/ipc-context";
import { createSettingsPageStore, type SettingsPageStore } from "./settings-page-store";

type SettingsPageActions = {
  readonly reload: () => void;
  readonly selectDirectory: () => void;
  readonly clearRootPath: () => void;
  readonly saveKey: (key: SecretKey, value: string) => void;
  readonly removeKey: (key: SecretKey) => void;
};

type SettingsPageContextValue = {
  readonly store: SettingsPageStore;
  readonly actions: SettingsPageActions;
};

const SettingsPageContext = createContext<SettingsPageContextValue | null>(null);

function useSettingsPageContextValue(): SettingsPageContextValue {
  const context = useContext(SettingsPageContext);
  if (!context) throw new Error("SettingsPageProvider is missing from the component tree");
  return context;
}

export function useSettingsPageStore(): SettingsPageStore {
  return useSettingsPageContextValue().store;
}

export function useSettingsPageActions(): SettingsPageActions {
  return useSettingsPageContextValue().actions;
}

export function useSettingsPageSelector<T>(
  selector: (snapshot: ReturnType<SettingsPageStore["getSnapshot"]>) => T,
): T {
  const store = useSettingsPageStore();
  return useSelector(store, selector);
}

export function SettingsPageProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const ipc = useIpc();
  const store = useMemo(() => createSettingsPageStore(), []);

  const reload = useCallback(() => {
    store.send({ type: "setLoading" });

    void Effect.runPromise(
      Effect.all(
        {
          settings: ipc.client.GetSettings(),
          openai: ipc.client.HasApiKey({ key: "openai-api-key" }),
          anthropic: ipc.client.HasApiKey({ key: "anthropic-api-key" }),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.tap(({ settings, openai, anthropic }) =>
          Effect.sync(() => {
            store.send({
              type: "loadSuccess",
              rootPath: settings.workspace.rootPath,
              openaiConfigured: openai.configured,
              anthropicConfigured: anthropic.configured,
            });
          }),
        ),
        Effect.catchAll(() =>
          Effect.sync(() => {
            store.send({
              type: "loadError",
              error: "Failed to load settings",
            });
          }),
        ),
      ),
    );
  }, [ipc, store]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectDirectory = useCallback(() => {
    store.send({ type: "setRootPathSaving" });

    void Effect.runPromise(
      ipc.client.SelectDirectory().pipe(
        Effect.flatMap((result) => {
          if (result.path === null) {
            return Effect.sync(() => {
              store.send({
                type: "rootPathSaved",
                rootPath: store.getSnapshot().context.rootPath,
              });
            });
          }
          return ipc.client
            .SetWorkspaceRootPath({ rootPath: result.path })
            .pipe(
              Effect.tap((settings) =>
                Effect.sync(() => {
                  store.send({
                    type: "rootPathSaved",
                    rootPath: settings.workspace.rootPath,
                  });
                }),
              ),
            );
        }),
        Effect.catchAll(() =>
          Effect.sync(() => {
            store.send({
              type: "rootPathSaveError",
              error: "Failed to set workspace path",
            });
          }),
        ),
      ),
    );
  }, [ipc, store]);

  const clearRootPath = useCallback(() => {
    store.send({ type: "setRootPathSaving" });

    void Effect.runPromise(
      ipc.client.SetWorkspaceRootPath({ rootPath: null }).pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            store.send({
              type: "rootPathSaved",
              rootPath: settings.workspace.rootPath,
            });
          }),
        ),
        Effect.catchAll(() =>
          Effect.sync(() => {
            store.send({
              type: "rootPathSaveError",
              error: "Failed to clear workspace path",
            });
          }),
        ),
      ),
    );
  }, [ipc, store]);

  const saveKey = useCallback(
    (key: SecretKey, value: string) => {
      store.send({ type: "setApiKeySaving", key });

      void Effect.runPromise(
        ipc.client.SetApiKey({ key, value }).pipe(
          Effect.flatMap(() => ipc.client.HasApiKey({ key })),
          Effect.tap((result) =>
            Effect.sync(() => {
              store.send({
                type: "apiKeySaved",
                key,
                configured: result.configured,
              });
            }),
          ),
          Effect.catchAll(() =>
            Effect.sync(() => {
              store.send({
                type: "apiKeySaveError",
                key,
                error: "Failed to save key",
              });
            }),
          ),
        ),
      );
    },
    [ipc, store],
  );

  const removeKey = useCallback(
    (key: SecretKey) => {
      store.send({ type: "setApiKeySaving", key });

      void Effect.runPromise(
        ipc.client.DeleteApiKey({ key }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              store.send({
                type: "apiKeySaved",
                key,
                configured: false,
              });
            }),
          ),
          Effect.catchAll(() =>
            Effect.sync(() => {
              store.send({
                type: "apiKeySaveError",
                key,
                error: "Failed to remove key",
              });
            }),
          ),
        ),
      );
    },
    [ipc, store],
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
      store,
      actions,
    }),
    [store, actions],
  );

  return <SettingsPageContext.Provider value={value}>{children}</SettingsPageContext.Provider>;
}
