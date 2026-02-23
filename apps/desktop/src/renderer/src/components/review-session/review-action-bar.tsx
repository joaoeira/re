import { useState } from "react";
import { EllipsisVertical, Pencil, Trash2 } from "lucide-react";
import type { FSRSGrade } from "@shared/rpc/schemas/review";

import { GradeButtons } from "@/components/review-session/grade-buttons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type ReviewActionBarProps = {
  readonly mode: "reveal" | "grade";
  readonly onReveal: () => void;
  readonly onGrade: (grade: FSRSGrade) => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
  readonly gradingDisabled: boolean;
  readonly actionsDisabled: boolean;
};

export function ReviewActionBar({
  mode,
  onReveal,
  onGrade,
  onEdit,
  onDelete,
  gradingDisabled,
  actionsDisabled,
}: ReviewActionBarProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  return (
    <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
      <div className="mx-auto grid max-w-xl grid-cols-[1fr_auto_1fr] items-center">
        <div />

        {mode === "reveal" ? (
          <button
            type="button"
            onClick={onReveal}
            className="flex h-7 items-center gap-3 border border-border px-3 text-xs transition-colors hover:border-foreground"
          >
            <span>Show Answer</span>
            <Kbd>Space</Kbd>
          </button>
        ) : (
          <GradeButtons disabled={gradingDisabled} onGrade={onGrade} />
        )}

        <div className="flex justify-start pl-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={actionsDisabled}
              aria-label="Card actions"
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionsDisabled}
                  className="h-7 w-7 rounded-none p-0"
                />
              }
            >
              <EllipsisVertical className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil />
                Edit
                <DropdownMenuShortcut>E</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete card</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the card from its deck file. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDeleteDialogOpen(false);
                onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Kbd({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
      {children}
    </kbd>
  );
}
