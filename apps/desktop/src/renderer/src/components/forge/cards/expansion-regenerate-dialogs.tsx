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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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
        <DialogContent className="w-[460px] max-w-[calc(100vw-2rem)] p-0">
          <div className="flex flex-col gap-4 px-5 pt-5 pb-4">
            <DialogTitle className="text-[11px] tracking-wider uppercase text-muted-foreground">
              Regeneration instruction
            </DialogTitle>

            {errorMessage ? (
              <p role="alert" className="text-xs text-destructive">
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

          <div className="flex items-center justify-between gap-4 border-t border-foreground/[0.06] px-5 py-2.5">
            <kbd className="text-[11px] text-foreground/20">⌘↵</kbd>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onEditOpenChange(false)}
                disabled={isGenerating}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={onEditConfirm} disabled={isGenerating}>
                Regenerate
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
