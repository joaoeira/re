import { useCallback, useEffect, useMemo, useState } from "react";

import type { MetadataParseError } from "@re/core";
import type { ScanDecksError, SnapshotWorkspaceResult } from "@re/workspace";
import type { SettingsError } from "@shared/settings";
import { Effect } from "effect";
import { RpcDefectError } from "electron-effect-rpc/renderer";
import { appMachine } from "@shared/state/appMachine";
import { uiStore } from "@shared/state/uiStore";
import { SilkButton } from "@shared/ui/silk-button";
import { createActor } from "xstate";

import { createIpc } from "../lib/ipc";

const DEFAULT_DECK_MARKDOWN = `---
title: Demo Deck
---

<!--@ card-1 0 0 0 0-->
What is 2 + 2?
---
4

<!--@ card-2 3.2 4.1 2 0 2026-01-01T10:00:00.000Z-->
What is the capital of France?
---
Paris
`;

type BootstrapData = {
  appName: string;
  message: string;
  timestamp: string;
};

type DeckPreview = {
  items: number;
  cards: number;
};

const DEFAULT_SNAPSHOT_OPTIONS = {
  includeHidden: false,
  extraIgnorePatterns: [],
} satisfies {
  includeHidden: boolean;
  extraIgnorePatterns: readonly string[];
};

const toRpcDefectMessage = (error: RpcDefectError): string =>
  `RPC defect (${error.code}): ${error.message}`;

const toParseErrorMessage = (error: MetadataParseError): string => {
  switch (error._tag) {
    case "ParseError":
      return `${error.message} (line ${error.line}, column ${error.column})`;
    case "InvalidMetadataFormat":
      return `Invalid metadata at line ${error.line}: ${error.reason}`;
    case "InvalidFieldValue":
      return `Invalid ${error.field} value "${error.value}" at line ${error.line}; expected ${error.expected}.`;
  }
};

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
  const [bootstrapData, setBootstrapData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(uiStore.getSnapshot().context.counter);
  const [markdown, setMarkdown] = useState(DEFAULT_DECK_MARKDOWN);
  const [workspaceRootPath, setWorkspaceRootPath] = useState<string | null>(null);
  const [workspaceRootInput, setWorkspaceRootInput] = useState("");
  const [settingsReadError, setSettingsReadError] = useState<string | null>(null);
  const [settingsActionError, setSettingsActionError] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingRootPath, setIsSavingRootPath] = useState(false);
  const [preview, setPreview] = useState<DeckPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState<SnapshotWorkspaceResult | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false);
  const actor = useMemo(() => createActor(appMachine), []);
  const ipc = useMemo(() => {
    if (!window.desktopApi) {
      return null;
    }

    return createIpc(window.desktopApi);
  }, []);

  const loadWorkspaceSnapshot = useCallback(
    (rootPath: string) => {
      if (!ipc) {
        setSnapshotResult(null);
        setSnapshotError("Desktop IPC bridge is unavailable.");
        setIsLoadingSnapshot(false);
        return;
      }

      setIsLoadingSnapshot(true);
      setSnapshotResult(null);
      setSnapshotError(null);

      void Effect.runPromise(
        ipc.client.GetWorkspaceSnapshot({
          rootPath,
          options: DEFAULT_SNAPSHOT_OPTIONS,
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              setSnapshotResult(result);
              setSnapshotError(null);
            }),
          ),
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.sync(() => {
              setSnapshotResult(null);
              setSnapshotError(toRpcDefectMessage(rpcDefect));
            }),
          ),
          Effect.catchAll((workspaceError) =>
            Effect.sync(() => {
              setSnapshotResult(null);
              setSnapshotError(toScanErrorMessage(workspaceError));
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              setIsLoadingSnapshot(false);
            }),
          ),
        ),
      );
    },
    [ipc],
  );

  useEffect(() => {
    if (!ipc) {
      setError(
        "Preload bridge is unavailable. Confirm the preload script is loading and exposes window.desktopApi.",
      );
      return;
    }

    const subscription = uiStore.subscribe((snapshot) => {
      setCounter(snapshot.context.counter);
    });

    actor.start();
    actor.send({ type: "BOOT" });
    setIsLoadingSettings(true);

    void Effect.runPromise(
      ipc.client.GetBootstrapData().pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            setBootstrapData(result);
            setError(null);
          }),
        ),
        Effect.catchTag("RpcDefectError", (rpcDefect) =>
          Effect.sync(() => {
            setBootstrapData(null);
            setError(toRpcDefectMessage(rpcDefect));
          }),
        ),
      ),
    );

    void Effect.runPromise(
      ipc.client.GetSettings().pipe(
        Effect.tap((settings) =>
          Effect.sync(() => {
            setWorkspaceRootPath(settings.workspace.rootPath);
            setWorkspaceRootInput(settings.workspace.rootPath ?? "");
            setSettingsReadError(null);
            setSettingsActionError(null);
            if (settings.workspace.rootPath) {
              loadWorkspaceSnapshot(settings.workspace.rootPath);
            } else {
              setSnapshotResult(null);
              setSnapshotError(null);
              setIsLoadingSnapshot(false);
            }
          }),
        ),
        Effect.catchTag("RpcDefectError", (rpcDefect) =>
          Effect.sync(() => {
            setWorkspaceRootPath(null);
            setWorkspaceRootInput("");
            setSettingsReadError(toRpcDefectMessage(rpcDefect));
            setSnapshotResult(null);
            setSnapshotError(null);
            setIsLoadingSnapshot(false);
          }),
        ),
        Effect.catchAll((settingsError) =>
          Effect.sync(() => {
            setWorkspaceRootPath(null);
            setWorkspaceRootInput("");
            setSettingsReadError(toSettingsErrorMessage(settingsError));
            setSnapshotResult(null);
            setSnapshotError(null);
            setIsLoadingSnapshot(false);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsLoadingSettings(false);
          }),
        ),
      ),
    );

    return () => {
      actor.stop();
      subscription.unsubscribe();
    };
  }, [actor, ipc, loadWorkspaceSnapshot]);

  const analyzeDeck = useCallback(() => {
    if (!ipc) {
      setPreviewError("Desktop IPC bridge is unavailable.");
      return;
    }

    setIsAnalyzing(true);
    setPreviewError(null);

    void Effect.runPromise(
      ipc.client.ParseDeckPreview({ markdown }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            setPreview(result);
            setPreviewError(null);
          }),
        ),
        Effect.catchTag("RpcDefectError", (rpcDefect) =>
          Effect.sync(() => {
            setPreview(null);
            setPreviewError(toRpcDefectMessage(rpcDefect));
          }),
        ),
        Effect.catchAll((parseError) =>
          Effect.sync(() => {
            setPreview(null);
            setPreviewError(toParseErrorMessage(parseError));
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsAnalyzing(false);
          }),
        ),
      ),
    );
  }, [ipc, markdown]);

  const persistWorkspaceRootPath = useCallback(
    (rootPath: string | null) => {
      if (!ipc) {
        setSettingsActionError("Desktop IPC bridge is unavailable.");
        return;
      }

      if (settingsReadError) {
        setSettingsActionError(
          "Settings storage is unavailable. Resolve the settings file issue before writing.",
        );
        return;
      }

      setIsSavingRootPath(true);
      setSettingsActionError(null);

      void Effect.runPromise(
        ipc.client.SetWorkspaceRootPath({ rootPath }).pipe(
          Effect.tap((settings) =>
            Effect.sync(() => {
              setWorkspaceRootPath(settings.workspace.rootPath);
              setWorkspaceRootInput(settings.workspace.rootPath ?? "");
              setSettingsActionError(null);
              if (settings.workspace.rootPath) {
                loadWorkspaceSnapshot(settings.workspace.rootPath);
              } else {
                setSnapshotResult(null);
                setSnapshotError(null);
                setIsLoadingSnapshot(false);
              }
            }),
          ),
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.sync(() => {
              setSettingsActionError(toRpcDefectMessage(rpcDefect));
            }),
          ),
          Effect.catchAll((settingsError) =>
            Effect.sync(() => {
              setSettingsActionError(toSettingsErrorMessage(settingsError));
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              setIsSavingRootPath(false);
            }),
          ),
        ),
      );
    },
    [ipc, loadWorkspaceSnapshot, settingsReadError],
  );

  const saveWorkspaceRootPath = useCallback(() => {
    const nextRootPath = workspaceRootInput.trim();
    if (nextRootPath === "") {
      setSettingsActionError(
        "Workspace root path cannot be empty. Use Clear Root Path to unset it.",
      );
      return;
    }

    persistWorkspaceRootPath(nextRootPath);
  }, [persistWorkspaceRootPath, workspaceRootInput]);

  const clearWorkspaceRootPath = useCallback(() => {
    persistWorkspaceRootPath(null);
  }, [persistWorkspaceRootPath]);

  const workspaceSnapshotSummary = useMemo(() => {
    if (!snapshotResult) {
      return null;
    }

    let okDecks = 0;
    let readErrorDecks = 0;
    let parseErrorDecks = 0;
    let totalCards = 0;
    let newCards = 0;
    let learningCards = 0;
    let reviewCards = 0;
    let relearningCards = 0;

    for (const deck of snapshotResult.decks) {
      switch (deck.status) {
        case "ok":
          okDecks += 1;
          totalCards += deck.totalCards;
          newCards += deck.stateCounts.new;
          learningCards += deck.stateCounts.learning;
          reviewCards += deck.stateCounts.review;
          relearningCards += deck.stateCounts.relearning;
          break;
        case "read_error":
          readErrorDecks += 1;
          break;
        case "parse_error":
          parseErrorDecks += 1;
          break;
      }
    }

    return {
      rootPath: snapshotResult.rootPath,
      totalDecks: snapshotResult.decks.length,
      okDecks,
      readErrorDecks,
      parseErrorDecks,
      totalCards,
      newCards,
      learningCards,
      reviewCards,
      relearningCards,
    };
  }, [snapshotResult]);

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
          re Desktop
        </p>
        <h1 className="text-3xl font-semibold text-foreground">Desktop App Shell</h1>
        <p className="text-sm text-muted-foreground">
          TanStack Router, Effect RPC, XState, and shared re parsing logic are wired and ready.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-background p-4">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">RPC Status</h2>
          {bootstrapData ? (
            <div className="mt-2 space-y-1 text-sm">
              <p>
                <span className="font-medium">App:</span> {bootstrapData.appName}
              </p>
              <p>
                <span className="font-medium">Message:</span> {bootstrapData.message}
              </p>
              <p>
                <span className="font-medium">Timestamp:</span> {bootstrapData.timestamp}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Loading bootstrap data from main...
            </p>
          )}
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="rounded-lg border border-border bg-background p-4">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">Store Example</h2>
          <p className="mt-2 text-sm">Counter: {counter}</p>
          <div className="mt-3 flex gap-2">
            <SilkButton onClick={() => uiStore.send({ type: "increment", by: 1 })}>
              Increment
            </SilkButton>
            <SilkButton
              className="bg-secondary text-secondary-foreground"
              onClick={() => uiStore.send({ type: "resetCounter" })}
            >
              Reset
            </SilkButton>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Workspace Settings
          </h2>

          <p className="mt-2 text-xs text-muted-foreground">
            {isLoadingSettings
              ? "Loading workspace settings..."
              : `Current root: ${workspaceRootPath ?? "(unset)"}`}
          </p>

          <input
            className="mt-3 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="/absolute/path/to/workspace"
            value={workspaceRootInput}
            onChange={(event) => setWorkspaceRootInput(event.target.value)}
            disabled={isLoadingSettings || Boolean(settingsReadError)}
          />

          <div className="mt-3 flex items-center gap-2">
            <SilkButton
              onClick={saveWorkspaceRootPath}
              disabled={isSavingRootPath || isLoadingSettings || !ipc || Boolean(settingsReadError)}
            >
              {isSavingRootPath ? "Saving..." : "Save Root Path"}
            </SilkButton>
            <SilkButton
              className="bg-secondary text-secondary-foreground"
              onClick={clearWorkspaceRootPath}
              disabled={isSavingRootPath || isLoadingSettings || !ipc || Boolean(settingsReadError)}
            >
              Clear Root Path
            </SilkButton>
          </div>

          {settingsReadError ? (
            <p className="mt-3 text-sm text-destructive">{settingsReadError}</p>
          ) : null}

          {settingsActionError ? (
            <p className="mt-2 text-sm text-destructive">{settingsActionError}</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-background p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Deck Preview (@re/core)
          </h2>

          <textarea
            className="mt-3 h-52 w-full rounded-md border border-input bg-background p-3 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            spellCheck={false}
          />

          <div className="mt-3 flex items-center gap-3">
            <SilkButton onClick={analyzeDeck} disabled={isAnalyzing || !ipc}>
              {isAnalyzing ? "Analyzing..." : "Analyze"}
            </SilkButton>
            <p className="text-xs text-muted-foreground">
              Calls main-process parser through typed IPC and returns item/card counts.
            </p>
          </div>

          {preview ? (
            <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
              <p>
                <span className="font-medium">Items:</span> {preview.items}
              </p>
              <p>
                <span className="font-medium">Cards:</span> {preview.cards}
              </p>
            </div>
          ) : null}

          {previewError ? <p className="mt-3 text-sm text-destructive">{previewError}</p> : null}
        </div>

        <div className="rounded-lg border border-border bg-background p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground">
            Workspace Snapshot (@re/workspace)
          </h2>

          <p className="mt-2 text-xs text-muted-foreground">
            Root: {workspaceRootPath ?? "(unset)"}
          </p>

          {isLoadingSnapshot ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading workspace snapshot...</p>
          ) : null}

          {workspaceSnapshotSummary ? (
            <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
              <p>
                <span className="font-medium">Resolved Root:</span> {workspaceSnapshotSummary.rootPath}
              </p>
              <p>
                <span className="font-medium">Total Decks:</span> {workspaceSnapshotSummary.totalDecks}
              </p>
              <p>
                <span className="font-medium">OK Decks:</span> {workspaceSnapshotSummary.okDecks}
              </p>
              <p>
                <span className="font-medium">Read Errors:</span> {workspaceSnapshotSummary.readErrorDecks}
              </p>
              <p>
                <span className="font-medium">Parse Errors:</span> {workspaceSnapshotSummary.parseErrorDecks}
              </p>
              <p className="mt-2">
                <span className="font-medium">Cards (OK decks):</span> {workspaceSnapshotSummary.totalCards}
              </p>
              <p>
                <span className="font-medium">New:</span> {workspaceSnapshotSummary.newCards}
              </p>
              <p>
                <span className="font-medium">Learning:</span> {workspaceSnapshotSummary.learningCards}
              </p>
              <p>
                <span className="font-medium">Review:</span> {workspaceSnapshotSummary.reviewCards}
              </p>
              <p>
                <span className="font-medium">Relearning:</span> {workspaceSnapshotSummary.relearningCards}
              </p>
            </div>
          ) : null}

          {snapshotError ? <p className="mt-3 text-sm text-destructive">{snapshotError}</p> : null}
        </div>
      </div>
    </section>
  );
}
