import { Button } from "@/components/ui/button";

type CardsFooterProps = {
  readonly addedCount: number;
  readonly totalCount: number;
};

export function CardsFooter({ addedCount, totalCount }: CardsFooterProps) {
  return (
    <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          <span className="font-mono font-medium text-primary">{addedCount}</span>
          <span className="text-muted-foreground/30"> / </span>
          <span className="font-mono">{totalCount}</span> cards added
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          className="gap-2 disabled:opacity-30"
        >
          <span>Save to deck</span>
          <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
            Cmd/Ctrl+Enter
          </kbd>
        </Button>
      </div>
    </div>
  );
}
