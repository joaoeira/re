import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";

import type { ScanDecksError } from "@re/workspace";
import type { SettingsError } from "@shared/settings";
import { WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { useDeckSelectionStore, useWorkspaceStore } from "@shared/state/stores-context";
import { Effect } from "effect";
import type { RpcDefectError } from "electron-effect-rpc/renderer";

import { DeckList } from "./deck-list";
import { SelectionToolbar } from "./selection-toolbar";
import { createIpc } from "../lib/ipc";

const DEFAULT_SNAPSHOT_OPTIONS = {
  includeHidden: false,
  extraIgnorePatterns: [],
} as const;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;
const RELATIVE_TIME = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const formatSnapshotAge = (asOf: string, now: Date): string => {
  const asOfDate = new Date(asOf);
  if (Number.isNaN(asOfDate.getTime())) {
    return asOf;
  }

  const deltaMs = asOfDate.getTime() - now.getTime();
  const absMs = Math.abs(deltaMs);

  if (absMs < MINUTE_MS) return "just now";
  if (absMs < HOUR_MS) return RELATIVE_TIME.format(Math.round(deltaMs / MINUTE_MS), "minute");
  if (absMs < DAY_MS) return RELATIVE_TIME.format(Math.round(deltaMs / HOUR_MS), "hour");
  if (absMs < MONTH_MS) return RELATIVE_TIME.format(Math.round(deltaMs / DAY_MS), "day");
  if (absMs < YEAR_MS) return RELATIVE_TIME.format(Math.round(deltaMs / MONTH_MS), "month");
  return RELATIVE_TIME.format(Math.round(deltaMs / YEAR_MS), "year");
};

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

  const ipc = useMemo(() => {
    if (!window.desktopApi) return null;
    return createIpc(window.desktopApi);
  }, []);

  const loadWorkspaceSnapshot = useCallback(
    (rootPath: string) => {
      if (!ipc) return;
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
    if (!ipc) {
      workspaceStore.send({ type: "setError", error: "Desktop IPC bridge is unavailable." });
      return;
    }

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

  const snapshotAge = formatSnapshotAge(snapshotResult.asOf, new Date());
  const selectedDeckPaths = Object.keys(selectedDecks);
  const decksByRelativePath = new Map(
    snapshotResult.decks.map((deckSnapshot) => [deckSnapshot.relativePath, deckSnapshot]),
  );
  const validSelectedDeckPaths = selectedDeckPaths.filter((relativePath) =>
    decksByRelativePath.has(relativePath),
  );

  const totalReviewableCards = snapshotResult.decks.reduce((total, snapshot) => {
    if (snapshot.status !== "ok") return total;
    return total + snapshot.dueCards + snapshot.stateCounts.new;
  }, 0);

  const selectedReviewableCards = validSelectedDeckPaths.reduce((total, relativePath) => {
    const snapshot = decksByRelativePath.get(relativePath);
    if (!snapshot || snapshot.status !== "ok") return total;
    return total + snapshot.dueCards + snapshot.stateCounts.new;
  }, 0);

  const hasSelectedDecks = validSelectedDeckPaths.length > 0;
  const toolbarVisible = totalReviewableCards > 0 || hasSelectedDecks;
  const reviewEnabled = hasSelectedDecks ? selectedReviewableCards > 0 : totalReviewableCards > 0;
  const toolbarReviewableCards = hasSelectedDecks ? selectedReviewableCards : totalReviewableCards;

  return (
    <>
      <div className="flex-1 overflow-auto">
        <DeckList snapshots={snapshotResult.decks} />
      </div>

      {toolbarVisible && (
        <SelectionToolbar
          selectedCount={validSelectedDeckPaths.length}
          reviewableCount={toolbarReviewableCards}
          reviewDisabled={!reviewEnabled}
          onClearSelection={() => deckSelectionStore.send({ type: "clear" })}
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
      )}
    </>
  );
}
