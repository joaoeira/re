import { useCallback, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { RpcDefectError } from "electron-effect-rpc/renderer";

import { PdfUploadZone } from "@/components/forge/pdf-upload-zone";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc-context";

type ExtractState =
  | { readonly status: "idle" }
  | { readonly status: "extracting" }
  | {
      readonly status: "success";
      readonly sessionId: number;
      readonly textLength: number;
      readonly preview: string;
    }
  | { readonly status: "error"; readonly message: string };

type SelectedPdf = {
  readonly fileName: string;
  readonly sourceFilePath: string;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
};

const toRpcDefectMessage = (error: RpcDefectError): string =>
  `RPC defect (${error.code}): ${error.message}`;

export function ForgePage() {
  const ipc = useIpc();
  const [selectedPdf, setSelectedPdf] = useState<SelectedPdf | null>(null);
  const [duplicateOfSessionId, setDuplicateOfSessionId] = useState<number | null>(null);
  const [extractState, setExtractState] = useState<ExtractState>({ status: "idle" });
  const extractionTokenRef = useRef(0);

  const handleFileSelected = useCallback((file: File | null) => {
    if (!file) {
      extractionTokenRef.current += 1;
      setSelectedPdf(null);
      setDuplicateOfSessionId(null);
      setExtractState({ status: "idle" });
      return;
    }

    const sourceFilePath = window.desktopHost.getPathForFile(file);

    if (sourceFilePath.length === 0) {
      extractionTokenRef.current += 1;
      setSelectedPdf(null);
      setDuplicateOfSessionId(null);
      setExtractState({
        status: "error",
        message: "Unable to resolve a local file path for the selected PDF.",
      });
      return;
    }

    extractionTokenRef.current += 1;
    setSelectedPdf({
      fileName: file.name,
      sourceFilePath,
    });
    setDuplicateOfSessionId(null);
    setExtractState({ status: "idle" });
  }, []);

  const beginExtraction = useCallback(() => {
    if (!selectedPdf || extractState.status === "extracting") {
      return;
    }

    setExtractState({ status: "extracting" });
    setDuplicateOfSessionId(null);
    const extractionToken = extractionTokenRef.current + 1;
    extractionTokenRef.current = extractionToken;

    void Effect.runPromise(
      ipc.client
        .ForgeCreateSession({
          sourceFilePath: selectedPdf.sourceFilePath,
        })
        .pipe(
          Effect.tap((created) =>
            Effect.sync(() => {
              if (extractionTokenRef.current !== extractionToken) return;
              setDuplicateOfSessionId(created.duplicateOfSessionId);
            }),
          ),
          Effect.flatMap((created) =>
            ipc.client.ForgeExtractText({
              sessionId: created.session.id,
            }),
          ),
          Effect.tap((extracted) =>
            Effect.sync(() => {
              if (extractionTokenRef.current !== extractionToken) return;
              setExtractState({
                status: "success",
                sessionId: extracted.sessionId,
                textLength: extracted.textLength,
                preview: extracted.preview,
              });
            }),
          ),
          Effect.catchTag("session_not_found", (error) =>
            Effect.sync(() => {
              if (extractionTokenRef.current !== extractionToken) return;
              setExtractState({
                status: "error",
                message: `Forge session was not found (id: ${error.sessionId}).`,
              });
            }),
          ),
          Effect.catchTag("forge_operation_error", (error) =>
            Effect.sync(() => {
              if (extractionTokenRef.current !== extractionToken) return;
              setExtractState({
                status: "error",
                message: error.message,
              });
            }),
          ),
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.sync(() => {
              if (extractionTokenRef.current !== extractionToken) return;
              setExtractState({
                status: "error",
                message: toRpcDefectMessage(rpcDefect),
              });
            }),
          ),
          Effect.catchAll((error) =>
            Effect.sync(() => {
              if (extractionTokenRef.current !== extractionToken) return;
              setExtractState({
                status: "error",
                message: String(error),
              });
            }),
          ),
        ),
    );
  }, [extractState.status, ipc.client, selectedPdf]);

  useEffect(() => {
    if (!selectedPdf) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey) return;
      if (event.key !== "Enter") return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      beginExtraction();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [beginExtraction, selectedPdf]);

  return (
    <main className="flex flex-1 flex-col bg-background">
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <PdfUploadZone onFileSelected={handleFileSelected} />

          {selectedPdf ? (
            <p className="text-xs text-muted-foreground">Selected: {selectedPdf.fileName}</p>
          ) : null}

          {duplicateOfSessionId !== null ? (
            <p className="text-xs text-amber-600">
              Duplicate source detected. Continuing with new session (existing session id:{" "}
              {duplicateOfSessionId}).
            </p>
          ) : null}

          {extractState.status === "extracting" ? (
            <p className="text-xs text-muted-foreground">
              Extracting text from the selected PDF...
            </p>
          ) : null}

          {extractState.status === "success" ? (
            <section className="space-y-2 border border-border bg-muted/20 p-3">
              <p className="text-xs text-foreground/85">
                Extraction complete for session {extractState.sessionId}. Characters extracted:{" "}
                {extractState.textLength}.
              </p>
              <pre className="max-h-60 overflow-auto border border-border bg-background p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                {extractState.preview}
              </pre>
            </section>
          ) : null}

          {extractState.status === "error" ? (
            <p role="alert" className="text-xs text-destructive">
              {extractState.message}
            </p>
          ) : null}
        </div>
      </div>

      {selectedPdf ? (
        <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={beginExtraction}
              disabled={extractState.status === "extracting"}
              className="gap-2 hover:border-foreground disabled:opacity-30"
            >
              <span>
                {extractState.status === "extracting" ? "Extracting..." : "Begin Extraction"}
              </span>
              <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                Cmd/Ctrl+Enter
              </kbd>
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
