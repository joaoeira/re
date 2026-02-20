import { useEffect } from "react";
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
  const hidden = !hasSelection && reviewableCount === 0;

  useEffect(() => {
    if (hidden) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (reviewDisabled) return;
      if (event.key !== " ") return;

      event.preventDefault();
      onReview();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hidden, reviewDisabled, onReview]);

  if (hidden) return null;

  return (
    <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
      <div className="mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-center">
        <div>
          {hasSelection && (
            <div className="flex items-center gap-1.5">
              <span className="tabular-nums text-xs text-muted-foreground">
                {selectedCount} selected
              </span>
              <button
                type="button"
                onClick={onClearSelection}
                className="text-muted-foreground/50 transition-colors hover:text-foreground"
                aria-label="Clear deck selection"
              >
                <X size={10} />
              </button>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reviewDisabled}
          onClick={onReview}
          className="gap-3 hover:border-foreground disabled:opacity-30"
        >
          <span className="text-xs">Review</span>
          <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
            Space
          </kbd>
        </Button>

        <span className="tabular-nums text-xs text-muted-foreground justify-self-end">
          {reviewableCount} due
        </span>
      </div>
    </div>
  );
}
