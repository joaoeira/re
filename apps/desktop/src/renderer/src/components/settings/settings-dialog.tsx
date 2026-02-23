import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector } from "@xstate/store-react";
import { Settings2, KeyRound } from "lucide-react";
import { Effect } from "effect";

import { useSettingsStore } from "@shared/state/stores-context";
import type { SettingsSection } from "@shared/state/settingsStore";
import type { SecretKey } from "@shared/secrets";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useIpc } from "@/lib/ipc-context";
import { GeneralSettings } from "./general-settings";
import { SecretsSettings } from "./secrets-settings";
import type { ApiKeyState } from "./api-key-field";

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof Settings2 }> = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "secrets", label: "Secrets", icon: KeyRound },
];

const DEFAULT_KEY_STATE: ApiKeyState = { configured: false, saving: false, error: null };

export function SettingsDialog() {
  const settingsStore = useSettingsStore();
  const open = useSelector(settingsStore, (s) => s.context.open);
  const section = useSelector(settingsStore, (s) => s.context.section);
  const ipc = useIpc();
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const [loading, setLoading] = useState(false);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [rootPathSaving, setRootPathSaving] = useState(false);
  const [rootPathError, setRootPathError] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<SecretKey, ApiKeyState>>({
    "openai-api-key": DEFAULT_KEY_STATE,
    "anthropic-api-key": DEFAULT_KEY_STATE,
  });

  const loadData = useCallback(() => {
    setLoading(true);
    setRootPathError(null);

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
            setRootPath(settings.workspace.rootPath);
            setApiKeys({
              "openai-api-key": { configured: openai.configured, saving: false, error: null },
              "anthropic-api-key": { configured: anthropic.configured, saving: false, error: null },
            });
            setLoading(false);
          }),
        ),
        Effect.catchAll(() =>
          Effect.sync(() => {
            setRootPathError("Failed to load settings");
            setLoading(false);
          }),
        ),
      ),
    );
  }, [ipc]);

  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  const handleSelectDirectory = useCallback(() => {
    setRootPathSaving(true);
    setRootPathError(null);

    void Effect.runPromise(
      ipc.client.SelectDirectory().pipe(
        Effect.flatMap((result) => {
          if (result.path === null) return Effect.succeed(undefined);
          return ipc.client
            .SetWorkspaceRootPath({ rootPath: result.path })
            .pipe(
              Effect.tap((settings) => Effect.sync(() => setRootPath(settings.workspace.rootPath))),
            );
        }),
        Effect.tap(() => Effect.sync(() => setRootPathSaving(false))),
        Effect.catchAll(() =>
          Effect.sync(() => {
            setRootPathError("Failed to set workspace path");
            setRootPathSaving(false);
          }),
        ),
      ),
    );
  }, [ipc]);

  const handleClearRootPath = useCallback(() => {
    setRootPathSaving(true);
    setRootPathError(null);

    void Effect.runPromise(
      ipc.client.SetWorkspaceRootPath({ rootPath: null }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setRootPath(null);
            setRootPathSaving(false);
          }),
        ),
        Effect.catchAll(() =>
          Effect.sync(() => {
            setRootPathError("Failed to clear workspace path");
            setRootPathSaving(false);
          }),
        ),
      ),
    );
  }, [ipc]);

  const handleSaveKey = useCallback(
    (key: SecretKey, value: string) => {
      setApiKeys((prev) => ({
        ...prev,
        [key]: { ...prev[key], saving: true, error: null },
      }));

      void Effect.runPromise(
        ipc.client.SetApiKey({ key, value }).pipe(
          Effect.flatMap(() => ipc.client.HasApiKey({ key })),
          Effect.tap((result) =>
            Effect.sync(() => {
              setApiKeys((prev) => ({
                ...prev,
                [key]: { configured: result.configured, saving: false, error: null },
              }));
            }),
          ),
          Effect.catchAll(() =>
            Effect.sync(() => {
              setApiKeys((prev) => ({
                ...prev,
                [key]: { ...prev[key], saving: false, error: "Failed to save key" },
              }));
            }),
          ),
        ),
      );
    },
    [ipc],
  );

  const handleRemoveKey = useCallback(
    (key: SecretKey) => {
      setApiKeys((prev) => ({
        ...prev,
        [key]: { ...prev[key], saving: true, error: null },
      }));

      void Effect.runPromise(
        ipc.client.DeleteApiKey({ key }).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setApiKeys((prev) => ({
                ...prev,
                [key]: { configured: false, saving: false, error: null },
              }));
            }),
          ),
          Effect.catchAll(() =>
            Effect.sync(() => {
              setApiKeys((prev) => ({
                ...prev,
                [key]: { ...prev[key], saving: false, error: "Failed to remove key" },
              }));
            }),
          ),
        ),
      );
    },
    [ipc],
  );

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const ids = SECTIONS.map((s) => s.id);
    const currentIndex = ids.indexOf(section);
    let nextIndex: number | null = null;

    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % ids.length;
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + ids.length) % ids.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = ids.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const nextId = ids[nextIndex]!;
      settingsStore.send({ type: "setSection", section: nextId });
      tabRefs.current.get(nextId)?.focus();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) settingsStore.send({ type: "closeSettings" });
      }}
    >
      <DialogContent className="flex h-[480px] w-[640px] overflow-hidden p-0">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <nav
          className="border-border bg-muted/30 flex w-[180px] shrink-0 flex-col gap-1 border-r p-3"
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
        >
          {SECTIONS.map((s) => {
            const isSelected = section === s.id;
            return (
              <button
                key={s.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(s.id, el);
                  else tabRefs.current.delete(s.id);
                }}
                id={`settings-tab-${s.id}`}
                role="tab"
                aria-selected={isSelected}
                aria-controls="settings-tabpanel"
                tabIndex={isSelected ? 0 : -1}
                className={`flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors ${
                  isSelected
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => settingsStore.send({ type: "setSection", section: s.id })}
                onKeyDown={handleTabKeyDown}
              >
                <s.icon size={14} />
                {s.label}
              </button>
            );
          })}
        </nav>

        <div
          id="settings-tabpanel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${section}`}
          className="flex-1 overflow-y-auto p-6"
        >
          {loading ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
              Loading...
            </div>
          ) : section === "general" ? (
            <GeneralSettings
              rootPath={rootPath}
              saving={rootPathSaving}
              error={rootPathError}
              onSelectDirectory={handleSelectDirectory}
              onClearRootPath={handleClearRootPath}
            />
          ) : (
            <SecretsSettings
              apiKeys={apiKeys}
              onSaveKey={handleSaveKey}
              onRemoveKey={handleRemoveKey}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
