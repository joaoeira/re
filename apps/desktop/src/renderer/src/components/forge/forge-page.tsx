import { useEffect } from "react";

import { PdfUploadZone } from "@/components/forge/pdf-upload-zone";
import { Button } from "@/components/ui/button";
import {
  ForgePageProvider,
  useForgeCurrentStep,
  useForgeDuplicateOfSessionId,
  useForgeExtractState,
  useForgeExtractSummary,
  useForgePageActions,
  useForgePreviewState,
  useForgeSelectedPdf,
  useForgeTopicsByChunk,
} from "./forge-page-context";

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
};

function ForgePageContent() {
  const actions = useForgePageActions();
  const currentStep = useForgeCurrentStep();
  const selectedPdf = useForgeSelectedPdf();
  const duplicateOfSessionId = useForgeDuplicateOfSessionId();
  const previewState = useForgePreviewState();
  const extractState = useForgeExtractState();
  const extractSummary = useForgeExtractSummary();
  const topicsByChunk = useForgeTopicsByChunk();

  useEffect(() => {
    if (!selectedPdf || currentStep !== "source") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey) return;
      if (event.key !== "Enter") return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      actions.beginExtraction();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, currentStep, selectedPdf]);

  return (
    <main className="flex flex-1 flex-col bg-background">
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          {currentStep === "source" ? (
            <>
              <PdfUploadZone onFileSelected={actions.handleFileSelected} />

              {selectedPdf ? (
                <p className="text-xs text-muted-foreground">Selected: {selectedPdf.fileName}</p>
              ) : null}

              {previewState.status === "loading" ? (
                <p className="text-xs text-muted-foreground">Estimating chunk count...</p>
              ) : null}

              {previewState.status === "ready" ? (
                <p className="text-xs text-muted-foreground">
                  Estimated {previewState.summary.chunkCount} chunk(s) across{" "}
                  {previewState.summary.totalPages} page(s) and {previewState.summary.textLength}{" "}
                  character(s).
                </p>
              ) : null}

              {previewState.status === "error" ? (
                <p role="alert" className="text-xs text-destructive">
                  {previewState.message}
                </p>
              ) : null}

              {duplicateOfSessionId !== null ? (
                <p className="text-xs text-amber-600">
                  Duplicate source detected. Continuing with new session (existing session id:{" "}
                  {duplicateOfSessionId}).
                </p>
              ) : null}

              {extractState.status === "extracting" ? (
                <p className="text-xs text-muted-foreground">
                  Running extraction and topic analysis for the selected PDF...
                </p>
              ) : null}

              {extractState.status === "error" ? (
                <p role="alert" className="text-xs text-destructive">
                  {extractState.message}
                </p>
              ) : null}
            </>
          ) : null}

          {currentStep === "topics" && extractSummary ? (
            <section className="space-y-3 border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium text-foreground/90">Step 2: Topic extraction</p>
              <p className="text-xs text-muted-foreground">Topics were extracted per chunk.</p>
              <dl className="grid grid-cols-1 gap-2 text-xs text-foreground/90 sm:grid-cols-4">
                <div className="border border-border bg-background px-2 py-1.5">
                  <dt className="text-muted-foreground">Chunks</dt>
                  <dd>{extractSummary.chunkCount}</dd>
                </div>
                <div className="border border-border bg-background px-2 py-1.5">
                  <dt className="text-muted-foreground">Pages</dt>
                  <dd>{extractSummary.totalPages}</dd>
                </div>
                <div className="border border-border bg-background px-2 py-1.5">
                  <dt className="text-muted-foreground">Characters</dt>
                  <dd>{extractSummary.textLength}</dd>
                </div>
                <div className="border border-border bg-background px-2 py-1.5">
                  <dt className="text-muted-foreground">Topic Chunks</dt>
                  <dd>{topicsByChunk.length}</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </div>
      </div>

      {currentStep === "source" && selectedPdf ? (
        <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={actions.beginExtraction}
              disabled={extractState.status === "extracting" || previewState.status !== "ready"}
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

export function ForgePage() {
  return (
    <ForgePageProvider>
      <ForgePageContent />
    </ForgePageProvider>
  );
}
