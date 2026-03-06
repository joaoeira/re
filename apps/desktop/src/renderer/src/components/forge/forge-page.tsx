import { useEffect, useMemo } from "react";

import { useForgeSessionListQuery } from "@/hooks/queries/use-forge-session-list-query";
import { Button } from "@/components/ui/button";

import { CardsStep } from "./cards/cards-step";
import { ForgeSourceCanvas } from "./forge-source-canvas";
import {
  ForgePageProvider,
  useForgeCurrentStep,
  useForgeDuplicateOfSessionId,
  useForgeExtractState,
  useForgePageActions,
  useForgePreviewState,
  useForgeSelectedSource,
  useForgeSourceEntryMode,
  useForgeResumeErrorMessage,
  useForgeSelectedTopicCount,
  useForgeTextDraft,
  useForgeTextTitleDraft,
} from "./forge-page-context";
import { ForgeTextEditor } from "./forge-text-editor";
import { SessionBrowser } from "./session-browser";
import { TopicSelection } from "./topics/topic-selection";

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
};

function ForgePageContent() {
  const actions = useForgePageActions();
  const currentStep = useForgeCurrentStep();
  const selectedSource = useForgeSelectedSource();
  const sourceEntryMode = useForgeSourceEntryMode();
  const duplicateOfSessionId = useForgeDuplicateOfSessionId();
  const previewState = useForgePreviewState();
  const extractState = useForgeExtractState();
  const textDraft = useForgeTextDraft();
  const textTitleDraft = useForgeTextTitleDraft();
  const selectedTopicCount = useForgeSelectedTopicCount();
  const resumeErrorMessage = useForgeResumeErrorMessage();
  const sessionListQuery = useForgeSessionListQuery();

  const resumableSessions = useMemo(
    () =>
      (sessionListQuery.data?.sessions ?? []).filter(
        (session) =>
          session.topicCount > 0 ||
          session.cardCount > 0 ||
          session.status === "extracting" ||
          session.status === "extracted" ||
          session.status === "topics_extracting",
      ),
    [sessionListQuery.data?.sessions],
  );
  const isTextEditorOpen = currentStep === "source" && sourceEntryMode === "text-editor";
  const isSourceEmpty = currentStep === "source" && sourceEntryMode === "picker" && !selectedSource;
  const showSessionBrowser = isSourceEmpty && resumableSessions.length > 0;
  const showSourcePicker =
    currentStep === "source" &&
    sourceEntryMode === "picker" &&
    (!isSourceEmpty || (!sessionListQuery.isLoading && !showSessionBrowser));

  useEffect(() => {
    if (currentStep === "source" && !selectedSource) return;
    if (currentStep === "cards") return;
    if (currentStep === "source" && sourceEntryMode === "text-editor") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.altKey) return;
      if (event.key !== "Enter") return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      if (currentStep === "source") actions.beginExtraction();
      if (currentStep === "topics") actions.advanceToCards();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, currentStep, selectedSource, sourceEntryMode]);

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      {currentStep === "cards" ? (
        <CardsStep />
      ) : isTextEditorOpen ? (
        <ForgeTextEditor
          draft={textDraft}
          titleDraft={textTitleDraft}
          errorMessage={extractState.status === "error" ? extractState.message : null}
          onDraftChange={actions.setTextDraft}
          onTitleChange={actions.setTextTitleDraft}
          onSubmit={actions.submitTextSource}
          onClose={actions.closeTextEditor}
          onDiscard={actions.closeTextEditor}
        />
      ) : (
        <>
          <div className="flex-1 overflow-auto px-6 py-8">
            {showSessionBrowser ? (
              <SessionBrowser
                sessions={resumableSessions}
                onResume={actions.resumeSession}
                onFileSelected={actions.handleFileSelected}
                onOpenTextEditor={actions.openTextEditor}
                errorMessage={resumeErrorMessage}
              />
            ) : showSourcePicker ? (
              <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
                <ForgeSourceCanvas
                  onOpenTextEditor={actions.openTextEditor}
                  onPdfSelected={actions.handleFileSelected}
                />

                {selectedSource?.kind === "pdf" ? (
                  <p className="text-xs text-muted-foreground">
                    Selected: {selectedSource.sourceLabel}
                  </p>
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
                    Running extraction and topic analysis for the selected source...
                  </p>
                ) : null}

                {extractState.status === "error" ? (
                  <p role="alert" className="text-xs text-destructive">
                    {extractState.message}
                  </p>
                ) : null}
              </div>
            ) : currentStep === "topics" ? (
              <TopicSelection />
            ) : null}
          </div>

          {currentStep === "source" &&
          sourceEntryMode === "picker" &&
          selectedSource?.kind === "pdf" ? (
            <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
              <div className="mx-auto flex w-full items-center justify-end gap-3">
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

          {currentStep === "topics" ? (
            <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
              <div className="mx-auto flex w-full items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {selectedTopicCount > 0 ? (
                    <>
                      <span className="font-mono font-medium text-primary">
                        {selectedTopicCount}
                      </span>{" "}
                      topic{selectedTopicCount !== 1 ? "s" : ""} selected
                      <span className="text-muted-foreground/30"> · </span>~{selectedTopicCount * 7}{" "}
                      cards estimated
                    </>
                  ) : (
                    "Select at least 1 topic to continue"
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectedTopicCount === 0 || extractState.status === "extracting"}
                  onClick={actions.advanceToCards}
                  className="gap-2 hover:border-foreground disabled:opacity-30"
                >
                  <span>Continue to cards</span>
                  <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                    Cmd/Ctrl+Enter
                  </kbd>
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

const noopSessionChange = () => {};

type ForgePageProps = {
  readonly initialSessionId?: number | null;
  readonly onSessionChange?: (session: { id: number; sourceLabel: string } | null) => void;
};

export function ForgePage({
  initialSessionId = null,
  onSessionChange = noopSessionChange,
}: ForgePageProps = {}) {
  return (
    <ForgePageProvider
      key={initialSessionId ?? "list"}
      initialSessionId={initialSessionId}
      onSessionChange={onSessionChange}
    >
      <ForgePageContent />
    </ForgePageProvider>
  );
}
