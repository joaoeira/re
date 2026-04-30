import { useEffect, useRef, useState } from "react";
import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  DEFAULT_REVIEW_SESSION_OPTIONS,
  isDefaultReviewSessionOptions,
  type ReviewSessionOptions,
  type ReviewSessionOrder,
} from "@shared/rpc/schemas/review";

type ReviewFooterProps = {
  readonly selectedCount: number;
  readonly selectedDeckNames: readonly string[];
  readonly metrics: {
    readonly newCount: number;
    readonly dueCount: number;
  };
  readonly totalReviewableCards: number;
  readonly reviewOptions: ReviewSessionOptions;
  readonly reviewDisabled: boolean;
  readonly onReviewOptionsChange: (options: ReviewSessionOptions) => void;
  readonly onReview: () => void;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
};

const isReviewOptionsTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest("[data-review-options-control]") !== null;

export function ReviewFooter({
  selectedCount,
  selectedDeckNames,
  metrics,
  totalReviewableCards,
  reviewOptions,
  reviewDisabled,
  onReviewOptionsChange,
  onReview,
}: ReviewFooterProps) {
  const hasSelection = selectedCount > 0;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const onReviewRef = useRef(onReview);
  onReviewRef.current = onReview;

  useEffect(() => {
    if (reviewDisabled || optionsOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== " ") return;
      if (isEditableTarget(event.target)) return;
      if (isReviewOptionsTarget(event.target)) return;

      event.preventDefault();
      onReviewRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [optionsOpen, reviewDisabled]);

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

      <div className="flex shrink-0 items-center gap-2">
        <ReviewOptionsAccessory
          open={optionsOpen}
          onOpenChange={setOptionsOpen}
          options={reviewOptions}
          onOptionsChange={onReviewOptionsChange}
        />

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
    </div>
  );
}

const ORDER_OPTIONS: ReadonlyArray<{
  readonly value: ReviewSessionOrder;
  readonly label: string;
}> = [
  { value: "default", label: "Default" },
  { value: "due-first", label: "Due first" },
  { value: "new-first", label: "New first" },
];

type ReviewOptionsAccessoryProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly options: ReviewSessionOptions;
  readonly onOptionsChange: (options: ReviewSessionOptions) => void;
};

function ReviewOptionsAccessory({
  open,
  onOpenChange,
  options,
  onOptionsChange,
}: ReviewOptionsAccessoryProps) {
  const isCustom = !isDefaultReviewSessionOptions(options);
  const updateOptions = (patch: Partial<ReviewSessionOptions>) => {
    onOptionsChange({ ...options, ...patch });
  };

  const setIncludeNew = (includeNew: boolean) => {
    if (!includeNew && !options.includeDue) return;
    updateOptions({ includeNew });
  };

  const setIncludeDue = (includeDue: boolean) => {
    if (!includeDue && !options.includeNew) return;
    updateOptions({ includeDue });
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger
        render={
          <Button
            type="button"
            variant="outline"
            size={isCustom ? "sm" : "icon-sm"}
            aria-label={isCustom ? "Review session options, custom" : "Review session options"}
            className={cn(
              "h-7 border-border/70 bg-background text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground aria-expanded:bg-muted/40",
              isCustom ? "gap-1.5 px-2 pr-2.5" : "w-7 p-0",
            )}
            data-review-options-control
          />
        }
      >
        <SlidersHorizontal className="size-3.5" />
        {isCustom && <span className="text-xs">Custom</span>}
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="top"
          align="end"
          sideOffset={8}
          className="isolate z-50 outline-none"
        >
          <PopoverPrimitive.Popup
            className="data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 bg-popover text-popover-foreground w-72 rounded-none border border-border shadow-sm duration-100 outline-none"
            data-review-options-control
          >
            <div className="flex flex-col py-1">
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-xs text-foreground">Review options</span>
                <button
                  type="button"
                  disabled={!isCustom}
                  className="text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  onClick={() => onOptionsChange(DEFAULT_REVIEW_SESSION_OPTIONS)}
                >
                  Reset
                </button>
              </div>

              <div className="flex min-h-9 items-center justify-between gap-3 border-t border-border/50 px-3 py-1.5">
                <span className="text-xs text-muted-foreground">Cards</span>
                <NumberFieldPrimitive.Root
                  value={options.cardLimit}
                  min={1}
                  step={1}
                  onValueChange={(value) =>
                    updateOptions({
                      cardLimit: value === null || value < 1 ? null : Math.trunc(value),
                    })
                  }
                >
                  <NumberFieldPrimitive.Group className="flex h-6 items-center border border-border/80 bg-background">
                    <NumberFieldPrimitive.Decrement className="flex h-6 w-6 items-center justify-center border-r border-border/70 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-30">
                      -
                    </NumberFieldPrimitive.Decrement>
                    <NumberFieldPrimitive.Input
                      aria-label="Card limit"
                      placeholder="All"
                      className="h-6 w-12 bg-transparent px-1.5 text-center text-xs tabular-nums outline-none placeholder:text-muted-foreground/50"
                    />
                    <NumberFieldPrimitive.Increment className="flex h-6 w-6 items-center justify-center border-l border-border/70 text-[11px] text-muted-foreground outline-none transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-30">
                      +
                    </NumberFieldPrimitive.Increment>
                  </NumberFieldPrimitive.Group>
                </NumberFieldPrimitive.Root>
              </div>

              <div className="flex min-h-9 items-center justify-between gap-3 border-t border-border/50 px-3 py-1.5">
                <span className="text-xs text-muted-foreground">Include</span>
                <div className="flex items-center gap-2.5">
                  <label className="flex items-center gap-1.5 text-xs text-foreground">
                    <Checkbox
                      checked={options.includeDue}
                      disabled={options.includeDue && !options.includeNew}
                      onCheckedChange={(checked) => setIncludeDue(checked === true)}
                    />
                    <span>Due</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-foreground">
                    <Checkbox
                      checked={options.includeNew}
                      disabled={options.includeNew && !options.includeDue}
                      onCheckedChange={(checked) => setIncludeNew(checked === true)}
                    />
                    <span>New</span>
                  </label>
                </div>
              </div>

              <div className="flex min-h-9 items-center justify-between gap-3 border-t border-border/50 px-3 py-1.5">
                <span className="text-xs text-muted-foreground">Order</span>
                <div className="flex items-center gap-1">
                  {ORDER_OPTIONS.map((orderOption) => {
                    const selected = options.order === orderOption.value;
                    return (
                      <button
                        key={orderOption.value}
                        type="button"
                        className={cn(
                          "h-6 px-1.5 text-[11px] transition-colors",
                          selected
                            ? "bg-muted/60 text-foreground"
                            : "text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground",
                        )}
                        onClick={() => updateOptions({ order: orderOption.value })}
                      >
                        {orderOption.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end border-t border-border/50 px-3 py-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  Done
                </button>
              </div>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
