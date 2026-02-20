import { Button } from "@/components/ui/button";

type SessionSummaryProps = {
  readonly stats: {
    reviewed: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
  readonly canUndo: boolean;
  readonly onUndo: () => void;
  readonly onBack: () => void;
};

export function SessionSummary({ stats, canUndo, onUndo, onBack }: SessionSummaryProps) {
  return (
    <div className="mx-auto flex w-full max-w-[70ch] flex-col gap-5">
      <h2 className="text-2xl font-semibold text-foreground">Session Complete</h2>
      <p className="text-sm text-muted-foreground">Reviewed: {stats.reviewed}</p>
      <p className="text-sm text-muted-foreground">
        Again: {stats.again} | Hard: {stats.hard} | Good: {stats.good} | Easy: {stats.easy}
      </p>
      <div className="flex items-center gap-2">
        {canUndo && (
          <Button type="button" size="sm" variant="outline" onClick={onUndo}>
            Undo
          </Button>
        )}
        <Button type="button" size="sm" onClick={onBack}>
          Back to decks
        </Button>
      </div>
    </div>
  );
}
