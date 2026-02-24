import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

type ReviewFooterProps = {
  readonly selectedCount: number;
  readonly selectedDeckNames: readonly string[];
  readonly metrics: {
    readonly newCount: number;
    readonly dueCount: number;
  };
  readonly totalReviewableCards: number;
  readonly reviewDisabled: boolean;
  readonly onReview: () => void;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
};

export function ReviewFooter({
  selectedCount,
  selectedDeckNames,
  metrics,
  totalReviewableCards,
  reviewDisabled,
  onReview,
}: ReviewFooterProps) {
  const hasSelection = selectedCount > 0;
  const onReviewRef = useRef(onReview);
  onReviewRef.current = onReview;

  useEffect(() => {
    if (reviewDisabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== " ") return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      onReviewRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reviewDisabled]);

  let reviewLabel: string;
  if (!hasSelection) {
    reviewLabel = "Review all";
  } else if (selectedDeckNames.length === 1) {
    reviewLabel = `Review ${selectedDeckNames[0]}`;
  } else {
    reviewLabel = `Review ${selectedCount} decks`;
  }

  return (
    <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5 overflow-hidden text-xs">
        {hasSelection ? (
          <span className="whitespace-nowrap text-muted-foreground">
            <span className="text-foreground">{selectedCount}</span> deck
            {selectedCount !== 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-muted-foreground/60">All decks</span>
        )}

        <span className="text-muted-foreground/20">&middot;</span>

        <div className="flex items-center gap-2 tabular-nums">
          {metrics.newCount > 0 && (
            <span className="text-state-new">
              {metrics.newCount} <span className="text-state-new/50 text-[10px]">new</span>
            </span>
          )}
          {metrics.dueCount > 0 && (
            <span className="text-state-review">
              {metrics.dueCount} <span className="text-state-review/50 text-[10px]">due</span>
            </span>
          )}
          {totalReviewableCards === 0 && (
            <span className="text-muted-foreground/40">nothing due</span>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={reviewDisabled}
        onClick={onReview}
        className="shrink-0 gap-2 hover:border-foreground disabled:opacity-30"
      >
        <span className="truncate text-xs">{reviewLabel}</span>
        {totalReviewableCards > 0 && (
          <span className="tabular-nums text-[11px] text-muted-foreground">
            {totalReviewableCards}
          </span>
        )}
        {totalReviewableCards > 0 && (
          <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
            Space
          </kbd>
        )}
      </Button>
    </div>
  );
}
