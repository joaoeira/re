import { useCallback, useEffect, useMemo, useState } from "react";

import type { ScanDecksError, SnapshotWorkspaceResult } from "@re/workspace";
import type { SettingsError } from "@shared/settings";
import { WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { Effect } from "effect";
import type { RpcDefectError } from "electron-effect-rpc/renderer";

import { DeckList } from "./deck-list";
import { createIpc } from "../lib/ipc";

const DEFAULT_SNAPSHOT_OPTIONS = {
  includeHidden: false,
  extraIgnorePatterns: [],
} as const;

const toRpcDefectMessage = (error: RpcDefectError): string =>
  `RPC defect (${error.code}): ${error.message}`;

const toScanErrorMessage = (error: ScanDecksError): string => {
  switch (error._tag) {
    case "WorkspaceRootNotFound":
      return `Workspace root not found: ${error.rootPath}`;
    case "WorkspaceRootNotDirectory":
      return `Workspace root is not a directory: ${error.rootPath}`;
    case "WorkspaceRootUnreadable":
      return `Workspace root is unreadable: ${error.message}`;
  }
};

const toSettingsErrorMessage = (error: SettingsError): string => {
  switch (error._tag) {
    case "SettingsReadFailed":
      return `Unable to read settings at ${error.path}: ${error.message}`;
    case "SettingsDecodeFailed":
      return `Settings file is invalid at ${error.path}: ${error.message}`;
    case "SettingsWriteFailed":
      return `Unable to write settings at ${error.path}: ${error.message}`;
    case "WorkspaceRootNotFound":
      return `Workspace root not found: ${error.rootPath}`;
    case "WorkspaceRootNotDirectory":
      return `Workspace root is not a directory: ${error.rootPath}`;
    case "WorkspaceRootUnreadable":
      return `Workspace root is unreadable: ${error.message}`;
  }
};

export function HomeScreen() {
  const [snapshotResult, setSnapshotResult] =
    useState<SnapshotWorkspaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const ipc = useMemo(() => {
    if (!window.desktopApi) return null;
    return createIpc(window.desktopApi);
  }, []);

  const loadWorkspaceSnapshot = useCallback(
    (rootPath: string) => {
      if (!ipc) return;
      setIsLoading(true);

      void Effect.runPromise(
        ipc.client
          .GetWorkspaceSnapshot({
            rootPath,
            options: DEFAULT_SNAPSHOT_OPTIONS,
          })
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                setSnapshotResult(result);
                setError(null);
              }),
            ),
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.sync(() => {
                setSnapshotResult(null);
                setError(toRpcDefectMessage(rpcDefect));
              }),
            ),
            Effect.catchAll((workspaceError) =>
              Effect.sync(() => {
                setSnapshotResult(null);
                setError(toScanErrorMessage(workspaceError));
              }),
            ),
            Effect.ensuring(Effect.sync(() => setIsLoading(false))),
          ),
      );
    },
    [ipc],
  );

  useEffect(() => {
    if (!ipc) {
      setError("Desktop IPC bridge is unavailable.");
      setIsLoading(false);
      return;
    }

    const unsubscribeSnapshot = ipc.events.subscribe(
      WorkspaceSnapshotChanged,
      (snapshot) => {
        setSnapshotResult(snapshot);
        setError(null);
        setIsLoading(false);
      },
    );

    void Effect.runPromise(
      ipc.client.GetSettings().pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            if (settings.workspace.rootPath) {
              loadWorkspaceSnapshot(settings.workspace.rootPath);
            } else {
              setSnapshotResult(null);
              setError(null);
              setIsLoading(false);
            }
          }),
        ),
        Effect.catchTag("RpcDefectError", (rpcDefect) =>
          Effect.sync(() => {
            setError(toRpcDefectMessage(rpcDefect));
            setIsLoading(false);
          }),
        ),
        Effect.catchAll((settingsError) =>
          Effect.sync(() => {
            setError(toSettingsErrorMessage(settingsError));
            setIsLoading(false);
          }),
        ),
      ),
    );

    return unsubscribeSnapshot;
  }, [ipc, loadWorkspaceSnapshot]);

  const handleDeckClick = useCallback((_relativePath: string) => {
    // Future: navigate to deck view
  }, []);

  if (isLoading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-destructive">{error}</div>
    );
  }

  if (!snapshotResult) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No workspace configured. Set a workspace root path in settings.
      </div>
    );
  }

  return (
    <section>
      <DeckList snapshots={snapshotResult.decks} onDeckClick={handleDeckClick} />
    </section>
  );
}
