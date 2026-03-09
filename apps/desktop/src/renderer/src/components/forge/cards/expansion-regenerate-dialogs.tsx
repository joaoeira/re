import { useLayoutEffect, useRef } from "react";

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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type PendingRegenerationConfirmation = {
  readonly descendantCount: number;
  readonly instructionText: string;
};

type ExpansionRegenerateDialogsProps = {
  readonly editOpen: boolean;
  readonly editInstruction: string;
  readonly pendingConfirmation: PendingRegenerationConfirmation | null;
  readonly errorMessage: string | null;
  readonly isGenerating: boolean;
  readonly onEditOpenChange: (open: boolean) => void;
  readonly onEditInstructionChange: (instruction: string) => void;
  readonly onEditConfirm: () => void;
  readonly onConfirmationOpenChange: (open: boolean) => void;
  readonly onConfirmationConfirm: () => void;
};

const autoResizeTextarea = (textarea: HTMLTextAreaElement | null) => {
  if (!textarea) return;

  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
};

export function ExpansionRegenerateDialogs({
  editOpen,
  editInstruction,
  pendingConfirmation,
  errorMessage,
  isGenerating,
  onEditOpenChange,
  onEditInstructionChange,
  onEditConfirm,
  onConfirmationOpenChange,
  onConfirmationConfirm,
}: ExpansionRegenerateDialogsProps) {
  const instructionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!editOpen) return;
    autoResizeTextarea(instructionTextareaRef.current);
  }, [editInstruction, editOpen]);

  return (
    <>
      <Dialog open={editOpen} onOpenChange={onEditOpenChange}>
        <DialogContent className="w-[560px] max-w-[calc(100vw-2rem)] p-0">
          <div className="border-b border-border px-5 py-4">
            <DialogTitle>Edit regeneration instruction</DialogTitle>
            <DialogDescription>
              Update or clear the instruction before regenerating these cards.
            </DialogDescription>
          </div>

          <div className="px-5 py-4">
            {errorMessage ? (
              <p role="alert" className="mb-3 text-xs text-destructive">
                {errorMessage}
              </p>
            ) : null}

            <textarea
              ref={instructionTextareaRef}
              aria-label="Regeneration instruction"
              autoFocus
              value={editInstruction}
              onChange={(event) => onEditInstructionChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !isGenerating) {
                  event.preventDefault();
                  onEditConfirm();
                }
              }}
              rows={1}
              disabled={isGenerating}
              className="w-full resize-none overflow-hidden bg-transparent text-sm leading-7 text-foreground/80 outline-none placeholder:text-muted-foreground/40 whitespace-pre-wrap break-words disabled:cursor-not-allowed disabled:opacity-60"
              placeholder="What should these cards focus on?"
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3">
            <kbd className="text-[11px] text-muted-foreground/35">⌘↵</kbd>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEditOpenChange(false)}
                disabled={isGenerating}
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={onEditConfirm} disabled={isGenerating}>
                Regenerate cards
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingConfirmation !== null} onOpenChange={onConfirmationOpenChange}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete descendant cards?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConfirmation
                ? `Regenerating these cards will delete ${pendingConfirmation.descendantCount} descendant card${pendingConfirmation.descendantCount === 1 ? "" : "s"}.`
                : ""}
            </AlertDialogDescription>
            {errorMessage ? (
              <p role="alert" className="text-xs text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isGenerating}>Keep current cards</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={onConfirmationConfirm}
              disabled={isGenerating}
            >
              Delete and regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
