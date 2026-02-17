import type { DeckStateCounts } from "@re/workspace";

const STATE_CONFIG = [
  { key: "new", label: "New", style: "bg-state-new/10 text-state-new" },
  { key: "learning", label: "Learning", style: "bg-state-learning/10 text-state-learning" },
  { key: "review", label: "Review", style: "bg-state-review/10 text-state-review" },
  { key: "relearning", label: "Relearning", style: "bg-state-relearning/10 text-state-relearning" },
] as const;

type DeckStateBadgesProps = {
  readonly stateCounts: DeckStateCounts;
};

export function DeckStateBadges({ stateCounts }: DeckStateBadgesProps) {
  return (
    <div className="flex items-center gap-1.5">
      {STATE_CONFIG.map(({ key, label, style }) => {
        const count = stateCounts[key];
        if (count === 0) return null;
        return (
          <span
            key={key}
            title={label}
            className={`inline-flex min-w-5 items-center justify-center px-1 py-0.5 text-xs tabular-nums font-medium ${style}`}
          >
            {count}
          </span>
        );
      })}
    </div>
  );
}
