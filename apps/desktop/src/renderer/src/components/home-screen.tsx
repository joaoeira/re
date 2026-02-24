import { useCallback, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

import type { ScanDecksError } from "@re/workspace";
import type { SettingsError } from "@shared/settings";
import { WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { useDeckSelectionStore, useWorkspaceStore } from "@shared/state/stores-context";
import { Effect } from "effect";
import type { RpcDefectError } from "electron-effect-rpc/renderer";

import { DeckList } from "./deck-list";
import { ReviewFooter } from "./review-footer";
import { useIpc } from "../lib/ipc-context";

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
  const navigate = useNavigate();
  const workspaceStore = useWorkspaceStore();
  const deckSelectionStore = useDeckSelectionStore();

  const workspaceStatus = useSelector(workspaceStore, (s) => s.context.status);
  const snapshotResult = useSelector(workspaceStore, (s) => s.context.snapshotResult);
  const workspaceError = useSelector(workspaceStore, (s) => s.context.error);
  const selectedDecks = useSelector(deckSelectionStore, (s) => s.context.selected);
  const ipc = useIpc();

  const loadWorkspaceSnapshot = useCallback(
    (rootPath: string) => {
      workspaceStore.send({ type: "setLoading" });

      void Effect.runPromise(
        ipc.client
          .GetWorkspaceSnapshot({
            rootPath,
            options: DEFAULT_SNAPSHOT_OPTIONS,
          })
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                workspaceStore.send({ type: "setSnapshot", snapshot: result });
              }),
            ),
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.sync(() => {
                workspaceStore.send({ type: "setError", error: toRpcDefectMessage(rpcDefect) });
              }),
            ),
            Effect.catchAll((workspaceError) =>
              Effect.sync(() => {
                workspaceStore.send({
                  type: "setError",
                  error: toScanErrorMessage(workspaceError),
                });
              }),
            ),
          ),
      );
    },
    [ipc, workspaceStore],
  );

  useEffect(() => {
    const unsubscribeSnapshot = ipc.events.subscribe(WorkspaceSnapshotChanged, (snapshot) => {
      workspaceStore.send({ type: "setSnapshot", snapshot });
    });

    void Effect.runPromise(
      ipc.client.GetSettings().pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            if (settings.workspace.rootPath) {
              loadWorkspaceSnapshot(settings.workspace.rootPath);
            } else {
              workspaceStore.send({ type: "setSnapshot", snapshot: null });
            }
          }),
        ),
        Effect.catchTag("RpcDefectError", (rpcDefect) =>
          Effect.sync(() => {
            workspaceStore.send({ type: "setError", error: toRpcDefectMessage(rpcDefect) });
          }),
        ),
        Effect.catchAll((settingsError) =>
          Effect.sync(() => {
            workspaceStore.send({ type: "setError", error: toSettingsErrorMessage(settingsError) });
          }),
        ),
      ),
    );

    return unsubscribeSnapshot;
  }, [ipc, loadWorkspaceSnapshot, workspaceStore]);

  if (workspaceStatus === "idle" || workspaceStatus === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading workspace...
      </div>
    );
  }

  if (workspaceError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {workspaceError}
      </div>
    );
  }

  if (!snapshotResult) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No workspace configured. Set a workspace root path in settings.
      </div>
    );
  }

  const selectedDeckPaths = Object.keys(selectedDecks);
  const decksByRelativePath = new Map(
    snapshotResult.decks.map((deckSnapshot) => [deckSnapshot.relativePath, deckSnapshot]),
  );
  const validSelectedDeckPaths = selectedDeckPaths.filter((relativePath) =>
    decksByRelativePath.has(relativePath),
  );

  const allMetrics = snapshotResult.decks.reduce(
    (acc, snapshot) => {
      if (snapshot.status !== "ok") return acc;
      return {
        newCount: acc.newCount + snapshot.stateCounts.new,
        dueCount: acc.dueCount + snapshot.dueCards,
      };
    },
    { newCount: 0, dueCount: 0 },
  );

  const selectedMetrics = validSelectedDeckPaths.reduce(
    (acc, relativePath) => {
      const snapshot = decksByRelativePath.get(relativePath);
      if (!snapshot || snapshot.status !== "ok") return acc;
      return {
        newCount: acc.newCount + snapshot.stateCounts.new,
        dueCount: acc.dueCount + snapshot.dueCards,
      };
    },
    { newCount: 0, dueCount: 0 },
  );

  const hasSelectedDecks = validSelectedDeckPaths.length > 0;
  const metrics = hasSelectedDecks ? selectedMetrics : allMetrics;
  const totalReviewableCards = metrics.newCount + metrics.dueCount;
  const reviewEnabled = totalReviewableCards > 0;

  const selectedDeckNames = validSelectedDeckPaths.map((path) => {
    const snapshot = decksByRelativePath.get(path);
    return snapshot?.name ?? path;
  });

  return (
    <>
      <div className="flex-1 overflow-auto">
        <DeckList snapshots={snapshotResult.decks} />
      </div>

      <ReviewFooter
        selectedCount={validSelectedDeckPaths.length}
        selectedDeckNames={selectedDeckNames}
        metrics={metrics}
        totalReviewableCards={totalReviewableCards}
        reviewDisabled={!reviewEnabled}
        onReview={() => {
          if (!reviewEnabled) return;

          void navigate({
            to: "/review",
            search: {
              decks: hasSelectedDecks ? validSelectedDeckPaths : "all",
            },
          });
        }}
      />
    </>
  );
}
