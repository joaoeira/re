import { Button } from "@/components/ui/button";
import { CardTypeSelector } from "@/components/editor/card-type-selector";
import { ClozeEditor } from "@/components/editor/cloze-editor";
import { DeckSelector } from "@/components/editor/deck-selector";
import { DuplicateWarning } from "@/components/editor/duplicate-warning";
import { QaEditor } from "@/components/editor/qa-editor";
import { useEditorSession, type EditorSearchParams } from "@/hooks/useEditorSession";

type EditorRootProps = {
  readonly search: EditorSearchParams;
};

export function EditorRoot({ search }: EditorRootProps) {
  const session = useEditorSession(search);
  const { context } = session;
  const deckSelectorDisabled = context.mode === "edit" || context.isSubmitting;

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background">
      <header className="border-b border-border px-4 py-3">
        <div className="mb-3 flex items-end gap-3">
          <DeckSelector
            deckPath={context.deckPath}
            decks={session.decks}
            disabled={deckSelectorDisabled}
            onChange={session.setDeckPath}
          />
          <CardTypeSelector
            cardType={context.cardType}
            disabled={context.isSubmitting}
            onChange={session.setCardType}
          />
          <Button
            type="button"
            size="sm"
            disabled={!session.canSubmit}
            onClick={() => {
              void session.submit();
            }}
          >
            {context.mode === "edit" ? "Save" : "Add"}
          </Button>
        </div>
        {context.isDuplicate && <DuplicateWarning deckPath={context.duplicateDeckPath} />}
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-4">
        {session.loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading editor...
          </div>
        ) : context.cardType === "qa" ? (
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
        ) : (
          <ClozeEditor
            content={context.clozeContent}
            frozen={context.clozeFrozen}
            onChange={session.setClozeContent}
            onToggleFrozen={session.toggleClozeFrozen}
          />
        )}
      </main>

      <footer className="flex min-h-9 items-center justify-between border-t border-border px-4 text-xs text-muted-foreground">
        <span>
          {context.mode === "edit" ? "Editing existing card" : `Added ${context.addedCount} card(s)`}
        </span>
        <span>{session.rootPath ?? "No workspace root configured"}</span>
      </footer>

      {context.lastError && (
        <div className="border-t border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {context.lastError}
        </div>
      )}
    </div>
  );
}
