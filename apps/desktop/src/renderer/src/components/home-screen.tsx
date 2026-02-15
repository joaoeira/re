import { useCallback, useEffect, useMemo, useState } from "react";

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

const toErrorMessage = (reason: unknown): string => {
  if (typeof reason === "object" && reason !== null && "message" in reason) {
    const message = reason.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "Unexpected RPC failure.";
};

export function HomeScreen() {
  const [bootstrapData, setBootstrapData] = useState<BootstrapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(uiStore.getSnapshot().context.counter);
  const [markdown, setMarkdown] = useState(DEFAULT_DECK_MARKDOWN);
  const [preview, setPreview] = useState<DeckPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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

    void ipc.client
      .GetBootstrapData()
      .then((result) => setBootstrapData(result))
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
      });

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



    void ipc.client
      .ParseDeckPreview({ markdown })
      .then((result) => {
        setPreview(result);
      })
      .catch((reason: unknown) => {
        setPreview(null);
        setPreviewError(toErrorMessage(reason));
      })
      .finally(() => {
        setIsAnalyzing(false);
      });
  }, [ipc, markdown]);

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
      </div>
    </section>
  );
}
