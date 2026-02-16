import { useCallback, useEffect, useMemo, useState } from "react";

import type { MetadataParseError } from "@re/core";
import type { ScanDecksError } from "@re/workspace";
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

type DeckScanResult = {
  rootPath: string;
  decks: readonly {
    absolutePath: string;
    relativePath: string;
    name: string;
  }[];
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
  const [scanResult, setScanResult] = useState<DeckScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const actor = useMemo(() => createActor(appMachine), []);
  const ipc = useMemo(() => {
    if (!window.desktopApi) {
      return null;
    }

    return createIpc(window.desktopApi);
  }, []);

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
          }),
        ),
        Effect.catchTag("RpcDefectError", (rpcDefect) =>
          Effect.sync(() => {
            setWorkspaceRootPath(null);
            setWorkspaceRootInput("");
            setSettingsReadError(toRpcDefectMessage(rpcDefect));
          }),
        ),
        Effect.catchAll((settingsError) =>
          Effect.sync(() => {
            setWorkspaceRootPath(null);
            setWorkspaceRootInput("");
            setSettingsReadError(toSettingsErrorMessage(settingsError));
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
  }, [actor, ipc]);

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
    [ipc, settingsReadError],
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

  const runDeckScan = useCallback(() => {
    if (!ipc) {
      setScanError("Desktop IPC bridge is unavailable.");
      return;
    }

    if (settingsReadError) {
      setScanError(
        "Settings could not be loaded. Resolve the settings file issue before scanning decks.",
      );
      return;
    }

    if (!workspaceRootPath) {
      setScanError("Set a workspace root path before scanning decks.");
      return;
    }

    setIsScanning(true);
    setScanError(null);

    void Effect.runPromise(
      ipc.client.ScanDecks({ rootPath: workspaceRootPath }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            setScanResult(result);
            setScanError(null);
          }),
        ),
        Effect.catchTag("RpcDefectError", (rpcDefect) =>
          Effect.sync(() => {
            setScanResult(null);
            setScanError(toRpcDefectMessage(rpcDefect));
          }),
        ),
        Effect.catchAll((scanError) =>
          Effect.sync(() => {
            setScanResult(null);
            setScanError(toScanErrorMessage(scanError));
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setIsScanning(false);
          }),
        ),
      ),
    );
  }, [ipc, settingsReadError, workspaceRootPath]);

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
            Deck Scan (@re/workspace)
          </h2>

          <p className="mt-2 text-xs text-muted-foreground">
            Root: {workspaceRootPath ?? "(unset)"}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <SilkButton
              onClick={runDeckScan}
              disabled={
                isScanning ||
                !ipc ||
                Boolean(settingsReadError) ||
                workspaceRootPath === null
              }
            >
              {isScanning ? "Scanning..." : "Scan Decks"}
            </SilkButton>
            <p className="text-xs text-muted-foreground">
              Calls main-process workspace scanner through typed IPC.
            </p>
          </div>

          {scanResult ? (
            <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
              <p>
                <span className="font-medium">Resolved Root:</span> {scanResult.rootPath}
              </p>
              <p>
                <span className="font-medium">Total Decks:</span> {scanResult.decks.length}
              </p>
              {scanResult.decks.length > 0 ? (
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {scanResult.decks
                    .slice(0, 6)
                    .map((deck) => `${deck.name} (${deck.relativePath})`)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {scanError ? <p className="mt-3 text-sm text-destructive">{scanError}</p> : null}
        </div>
      </div>
    </section>
  );
}
