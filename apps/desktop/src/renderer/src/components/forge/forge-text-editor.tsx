import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const countWords = (text: string): number => {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
};

type ForgeTextEditorProps = {
  readonly draft: string;
  readonly errorMessage?: string | null;
  readonly onDraftChange: (text: string) => void;
  readonly onSubmit: () => void;
  readonly onClose: () => void;
  readonly onDiscard: () => void;
};

export function ForgeTextEditor({
  draft,
  errorMessage,
  onDraftChange,
  onSubmit,
  onClose,
  onDiscard,
}: ForgeTextEditorProps) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const hasContent = draft.trim().length > 0;
  const wordCount = useMemo(() => countWords(draft), [draft]);

  const requestClose = () => {
    if (!hasContent) {
      onClose();
      return;
    }

    setDiscardOpen(true);
  };

  return (
    <>
      <div className="mx-auto flex h-full w-full max-w-3xl flex-1 flex-col px-6 py-8">
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={requestClose} className="gap-2">
            <ArrowLeft className="size-3.5" />
            <span>Back</span>
          </Button>

          {hasContent ? (
            <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
              Cmd/Ctrl+Enter
            </kbd>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col pt-8">
          <div className="space-y-2">
            <h1 className="text-lg font-medium text-foreground">Paste text</h1>
            <p className="max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Paste or write the source material directly. It will be extracted immediately as a
              text source labeled <span className="font-mono text-foreground/70">Pasted text</span>.
            </p>
            {errorMessage ? (
              <p role="alert" className="text-xs text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <div className="flex flex-1 flex-col pt-6">
            <Textarea
              aria-label="Paste source text"
              autoFocus
              value={draft}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && hasContent) {
                  event.preventDefault();
                  onSubmit();
                }
                if (event.key === "Escape" && !hasContent) {
                  event.preventDefault();
                  onClose();
                }
              }}
              placeholder="Paste text here…"
              className="min-h-[50vh] flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-7 shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-muted/20 px-6 py-2.5">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {hasContent ? (
              <>
                <span className="font-mono font-medium text-foreground/80">{wordCount}</span> word
                {wordCount === 1 ? "" : "s"}
              </>
            ) : (
              "Paste source text to continue"
            )}
          </p>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSubmit}
            disabled={!hasContent}
            className="gap-2 hover:border-foreground disabled:opacity-30"
          >
            <span>Extract topics</span>
            <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
              Cmd/Ctrl+Enter
            </kbd>
          </Button>
        </div>
      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard pasted text?</AlertDialogTitle>
            <AlertDialogDescription>
              Closing now will lose the current draft. It is only kept in memory until you extract
              it or discard it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDiscardOpen(false);
                onDiscard();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
