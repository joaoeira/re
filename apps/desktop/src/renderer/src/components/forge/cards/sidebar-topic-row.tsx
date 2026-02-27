import { cn } from "@/lib/utils";

import type { TopicGenerationStatus } from "./mock-cards-data";

type SidebarTopicRowProps = {
  readonly topicKey: string;
  readonly text: string;
  readonly active: boolean;
  readonly status: TopicGenerationStatus;
  readonly cardCount: number;
  readonly addedCount: number;
  readonly onSelect: (topicKey: string) => void;
};

function StatusDot({
  status,
  allAdded,
}: {
  readonly status: TopicGenerationStatus;
  readonly allAdded: boolean;
}) {
  const base = "inline-block size-2 shrink-0 rounded-full";

  if (status === "error") return <span className={cn(base, "bg-destructive")} />;
  if (status === "generating")
    return (
      <span className="inline-block size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
    );
  if (status === "idle") return <span className={cn(base, "border border-muted-foreground/30")} />;
  if (allAdded) return <span className={cn(base, "bg-primary")} />;
  return <span className={cn(base, "bg-muted-foreground/50")} />;
}

export function SidebarTopicRow({
  topicKey,
  text,
  active,
  status,
  cardCount,
  addedCount,
  onSelect,
}: SidebarTopicRowProps) {
  const allAdded = cardCount > 0 && addedCount === cardCount;

  return (
    <button
      type="button"
      onClick={() => onSelect(topicKey)}
      className={cn(
        "flex w-full items-start gap-2.5 border-l-2 px-4 py-2.5 text-left transition-colors",
        active ? "border-muted-foreground/60 bg-muted/50" : "border-transparent hover:bg-muted/30",
      )}
    >
      <div className="flex shrink-0 items-center pt-1">
        <StatusDot status={status} allAdded={allAdded} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-2 text-xs leading-relaxed",
            active ? "text-foreground/80" : "text-muted-foreground/70",
          )}
        >
          {text}
        </p>
        {cardCount > 0 && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/40">
            {cardCount} cards
            {allAdded && <span className="text-primary"> · done</span>}
          </p>
        )}
        {status === "error" && (
          <p className="mt-0.5 text-[10px] text-destructive">failed · retry</p>
        )}
      </div>
    </button>
  );
}
