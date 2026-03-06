import { ListTree } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type ReviewCommandDialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly canCreatePermutations: boolean;
  readonly onCreatePermutations: () => void;
};

export function ReviewCommandDialog({
  open,
  onOpenChange,
  canCreatePermutations,
  onCreatePermutations,
}: ReviewCommandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[420px] max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b border-border px-4 py-3">
          <DialogTitle>Review actions</DialogTitle>
          <DialogDescription>Choose an action for the current review card.</DialogDescription>
        </div>

        <div className="p-3">
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
            disabled={!canCreatePermutations}
            onClick={() => {
              onOpenChange(false);
              onCreatePermutations();
            }}
          >
            <ListTree className="size-4" />
            <span className="flex flex-col items-start gap-0.5">
              <span>Create permutations</span>
              <span className="text-[11px] text-muted-foreground">
                Generate related QA variations for the current card.
              </span>
            </span>
          </Button>

          {!canCreatePermutations ? (
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">
              This action is currently available only for QA review cards.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
