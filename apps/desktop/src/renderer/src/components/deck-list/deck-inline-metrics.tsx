type DeckInlineMetricsProps = {
  readonly newCount: number;
  readonly dueCount: number;
};

export function DeckInlineMetrics({ newCount, dueCount }: DeckInlineMetricsProps) {
  const parts: { key: string; count: number; className: string }[] = [];

  if (newCount > 0) parts.push({ key: "new", count: newCount, className: "text-state-new" });
  if (dueCount > 0) parts.push({ key: "due", count: dueCount, className: "text-state-review" });

  if (parts.length === 0) return null;

  const label = parts.map((p) => `${p.count} ${p.key}`).join(", ");

  return (
    <span
      className="ml-2.5 inline-flex shrink-0 items-center gap-0 text-xs tabular-nums"
      aria-label={label}
    >
      {parts.map((part, i) => (
        <span key={part.key} className="inline-flex items-center" aria-hidden="true">
          {i > 0 && <span className="mx-1.5 text-muted-foreground/30">&middot;</span>}
          <span className={part.className}>{part.count}</span>
        </span>
      ))}
    </span>
  );
}
