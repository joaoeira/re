type TopicHeaderCardProps = {
  readonly topicText: string;
  readonly cardCount: number;
  readonly addedCount: number;
  readonly hasUnadded: boolean;
  readonly onRegenerate: () => void;
};

export function TopicHeaderCard({
  topicText,
  cardCount,
  addedCount,
  hasUnadded,
  onRegenerate,
}: TopicHeaderCardProps) {
  return (
    <div className="border border-border bg-muted/20 px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
        Topic
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-foreground/80">{topicText}</p>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground/40">
        {cardCount > 0 && (
          <span>
            {cardCount} cards · {addedCount} added
          </span>
        )}
        {hasUnadded && (
          <>
            <span className="text-border">·</span>
            <button
              type="button"
              onClick={onRegenerate}
              className="text-muted-foreground/50 underline underline-offset-4 decoration-border transition-colors hover:text-foreground/60"
            >
              regenerate unadded
            </button>
          </>
        )}
      </div>
    </div>
  );
}
