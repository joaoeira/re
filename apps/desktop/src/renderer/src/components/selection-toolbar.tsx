import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

type SelectionToolbarProps = {
  readonly selectedCount: number;
  readonly reviewableCount: number;
  readonly reviewDisabled: boolean;
  readonly onClearSelection: () => void;
  readonly onReview: () => void;
};

export function SelectionToolbar({
  selectedCount,
  reviewableCount,
  reviewDisabled,
  onClearSelection,
  onReview,
}: SelectionToolbarProps) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex min-h-12 items-stretch border border-border bg-foreground text-background shadow-lg">
        {hasSelection ? (
          <>
            <div className="flex items-center gap-2 border-r border-dashed border-background/40 px-3">
              <span className="text-xs tabular-nums text-background/80">{selectedCount} selected</span>
              <button
                type="button"
                onClick={onClearSelection}
                className="inline-flex h-6 w-6 items-center justify-center text-background/70 transition-colors hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background"
                aria-label="Clear deck selection"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-3 px-3">
              <span className="text-xs tabular-nums text-background/80">
                {reviewableCount} cards due
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={reviewDisabled}
                onClick={onReview}
              >
                Review
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="text-xs tabular-nums text-background/80">{reviewableCount} cards due</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={reviewDisabled}
              onClick={onReview}
            >
              Review
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

