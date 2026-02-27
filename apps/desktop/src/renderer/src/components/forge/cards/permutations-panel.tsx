import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { ForgePermutation } from "./mock-cards-data";
import { MOCK_PERMUTATIONS } from "./mock-cards-data";

type PermutationsPanelProps = {
  readonly onAddPermutation: (permutation: ForgePermutation) => void;
};

export function PermutationsPanel({ onAddPermutation }: PermutationsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());

  const handleRegenerate = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 800);
  };

  return (
    <div className="mt-3 border-t border-dashed border-border/40 pt-3">
      <div className="mb-3 flex items-center justify-between">
        {loading ? (
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
            <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
            Generating variations…
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/40">
            {MOCK_PERMUTATIONS.length} variations generated
          </span>
        )}
        {!loading && (
          <button
            type="button"
            onClick={handleRegenerate}
            className="text-[11px] text-muted-foreground/40 underline underline-offset-4 decoration-border transition-colors hover:text-foreground/60"
          >
            regenerate
          </button>
        )}
      </div>

      {!loading &&
        MOCK_PERMUTATIONS.map((perm) => (
          <div
            key={perm.id}
            className="flex items-start gap-3 border-b border-border/20 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed text-foreground/70">{perm.question}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">{perm.answer}</p>
            </div>
            {addedIds.has(perm.id) ? (
              <span className="shrink-0 pt-0.5 text-[11px] text-primary">✓</span>
            ) : (
              <Button
                type="button"
                variant="default"
                size="xs"
                className="shrink-0"
                onClick={() => {
                  setAddedIds((prev) => new Set([...prev, perm.id]));
                  onAddPermutation(perm);
                }}
              >
                + Add
              </Button>
            )}
          </div>
        ))}
    </div>
  );
}
