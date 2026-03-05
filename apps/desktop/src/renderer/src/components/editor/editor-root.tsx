import { ArrowLeft, Braces, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClozeEditor } from "@/components/editor/cloze-editor";
import { ClozePreview } from "@/components/editor/cloze-preview";
import { DeckCombobox } from "@/components/editor/deck-combobox";
import { DuplicateWarning } from "@/components/editor/duplicate-warning";
import { QaEditor } from "@/components/editor/qa-editor";
import { useEditorSession, type EditorSearchParams } from "@/hooks/useEditorSession";

type EditorRootProps = {
  readonly search: EditorSearchParams;
};

export function EditorRoot({ search }: EditorRootProps) {
  const session = useEditorSession(search);
  const { context } = session;
  const isCloze = context.cardType === "cloze";
  const deckSelectionDisabled =
    session.loading ||
    session.rootPath === null ||
    session.creatingDeck ||
    context.mode === "edit" ||
    context.isSubmitting;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-2.5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => window.close()}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <span className="text-sm text-foreground">
            {context.mode === "edit" ? "Edit card" : "Add card"}
          </span>
        </div>
        {context.addedCount > 0 && (
          <span className="font-mono text-xs text-muted-foreground/60">
            {context.addedCount} added
          </span>
        )}
      </header>

      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto">
        {session.loading ? (
          <div className="flex items-center text-sm text-muted-foreground">Loading editor...</div>
        ) : (
          <div className="flex w-full max-w-[640px] flex-col gap-7 px-6 py-8">
            <DeckCombobox
              deckPath={context.deckPath}
              decks={session.decks}
              disabled={deckSelectionDisabled}
              onChange={session.setDeckPath}
              onCreateDeck={session.createDeck}
            />

            {context.isDuplicate && <DuplicateWarning deckPath={context.duplicateDeckPath} />}

            {isCloze ? (
              <>
                <ClozeEditor
                  content={context.frontContent}
                  frozen={context.frontFrozen}
                  onChange={session.setFrontContent}
                  onToggleFrozen={session.toggleFrontFrozen}
                />
                <ClozePreview content={context.frontContent} />
              </>
            ) : (
              <QaEditor
                frontContent={context.frontContent}
                backContent={context.backContent}
                frontFrozen={context.frontFrozen}
                backFrozen={context.backFrozen}
                onFrontChange={session.setFrontContent}
                onBackChange={session.setBackContent}
                onToggleFrontFrozen={session.toggleFrontFrozen}
                onToggleBackFrozen={session.toggleBackFrozen}
              />
            )}

            {session.flashMessage && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-1">
                <Check className="size-3" />
                {session.flashMessage}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="flex shrink-0 items-center justify-between border-t border-border px-5 py-2.5">
        <div className="text-xs text-muted-foreground">
          {isCloze && (
            <span className="flex items-center gap-1.5">
              <Braces className="size-3" />
              Cloze detected
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {context.lastError && (
            <span className="max-w-80 truncate text-xs text-destructive">{context.lastError}</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!session.canSubmit}
            onClick={() => {
              void session.submit();
            }}
            className="gap-2 hover:border-foreground disabled:opacity-30"
          >
            <span className="text-xs">{context.mode === "edit" ? "Save" : "Add card"}</span>
            <kbd className="border border-border px-1 py-0.5 text-[10px] text-muted-foreground/60">
              ⌘⏎
            </kbd>
          </Button>
        </div>
      </footer>
    </div>
  );
}
