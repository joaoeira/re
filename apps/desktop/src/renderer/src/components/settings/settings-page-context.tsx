import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useSelector } from "@xstate/store-react";
import { Effect, Fiber } from "effect";

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

const errorDetails = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) return error.message;

  if (typeof error === "object" && error !== null) {
    const maybeError = error as { _tag?: unknown; message?: unknown };
    const tag = typeof maybeError._tag === "string" ? maybeError._tag : null;
    const message = typeof maybeError.message === "string" ? maybeError.message : null;

    if (tag && message) return `${tag}: ${message}`;
    if (message) return message;
    if (tag) return tag;

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
};

const formatError = (prefix: string, error: unknown): string => `${prefix}: ${errorDetails(error)}`;

const logSettingsError = (action: string, error: unknown): void => {
  console.error(`[settings] ${action}`, error);
};

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

export function SettingsPageProvider({ children }: { children: React.ReactNode }) {
  const ipc = useIpc();
  const store = useMemo(() => createSettingsPageStore(), []);
  const fibersRef = useRef(new Set<Fiber.RuntimeFiber<unknown, unknown>>());

  const runTask = useCallback((effect: Effect.Effect<unknown>) => {
    let fiber: Fiber.RuntimeFiber<unknown, unknown> | null = null;

    const trackedEffect = effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (fiber !== null) fibersRef.current.delete(fiber);
        }),
      ),
    );

    fiber = Effect.runFork(trackedEffect);
    fibersRef.current.add(fiber);
  }, []);

  useEffect(
    () => () => {
      for (const fiber of fibersRef.current) {
        Effect.runFork(Fiber.interrupt(fiber));
      }
      fibersRef.current.clear();
    },
    [],
  );

  const reload = useCallback(() => {
    store.send({ type: "setLoading" });

    runTask(
      Effect.all(
        {
          settings: ipc.client.GetSettings(),
          openai: ipc.client.HasApiKey({ key: "openai-api-key" }),
          anthropic: ipc.client.HasApiKey({ key: "anthropic-api-key" }),
        },
        { concurrency: "unbounded" },
      ).pipe(
        Effect.match({
          onSuccess: ({ settings, openai, anthropic }) => {
            store.send({
              type: "loadSuccess",
              rootPath: settings.workspace.rootPath,
              openaiConfigured: openai.configured,
              anthropicConfigured: anthropic.configured,
            });
          },
          onFailure: (error) => {
            logSettingsError("load", error);
            store.send({
              type: "loadError",
              error: formatError("Failed to load settings", error),
            });
          },
        }),
      ),
    );
  }, [ipc, runTask, store]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectDirectory = useCallback(() => {
    store.send({ type: "setRootPathSaving" });

    runTask(
      ipc.client.SelectDirectory().pipe(
        Effect.flatMap((result) => {
          if (result.path === null) {
            return Effect.succeed({ rootPath: store.getSnapshot().context.rootPath });
          }
          return ipc.client
            .SetWorkspaceRootPath({ rootPath: result.path })
            .pipe(Effect.map((settings) => ({ rootPath: settings.workspace.rootPath })));
        }),
        Effect.match({
          onSuccess: ({ rootPath }) => {
            store.send({
              type: "rootPathSaved",
              rootPath,
            });
          },
          onFailure: (error) => {
            logSettingsError("set workspace root", error);
            store.send({
              type: "rootPathSaveError",
              error: formatError("Failed to set workspace path", error),
            });
          },
        }),
      ),
    );
  }, [ipc, runTask, store]);

  const clearRootPath = useCallback(() => {
    store.send({ type: "setRootPathSaving" });

    runTask(
      ipc.client.SetWorkspaceRootPath({ rootPath: null }).pipe(
        Effect.match({
          onSuccess: (settings) => {
            store.send({
              type: "rootPathSaved",
              rootPath: settings.workspace.rootPath,
            });
          },
          onFailure: (error) => {
            logSettingsError("clear workspace root", error);
            store.send({
              type: "rootPathSaveError",
              error: formatError("Failed to clear workspace path", error),
            });
          },
        }),
      ),
    );
  }, [ipc, runTask, store]);

  const saveKey = useCallback(
    (key: SecretKey, value: string) => {
      store.send({ type: "setApiKeySaving", key });

      runTask(
        ipc.client.SetApiKey({ key, value }).pipe(
          Effect.flatMap(() => ipc.client.HasApiKey({ key })),
          Effect.match({
            onSuccess: (result) => {
              store.send({
                type: "apiKeySaved",
                key,
                configured: result.configured,
              });
            },
            onFailure: (error) => {
              logSettingsError(`save API key (${key})`, error);
              store.send({
                type: "apiKeySaveError",
                key,
                error: formatError("Failed to save key", error),
              });
            },
          }),
        ),
      );
    },
    [ipc, runTask, store],
  );

  const removeKey = useCallback(
    (key: SecretKey) => {
      store.send({ type: "setApiKeySaving", key });

      runTask(
        ipc.client.DeleteApiKey({ key }).pipe(
          Effect.match({
            onSuccess: () => {
              store.send({
                type: "apiKeySaved",
                key,
                configured: false,
              });
            },
            onFailure: (error) => {
              logSettingsError(`remove API key (${key})`, error);
              store.send({
                type: "apiKeySaveError",
                key,
                error: formatError("Failed to remove key", error),
              });
            },
          }),
        ),
      );
    },
    [ipc, runTask, store],
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
