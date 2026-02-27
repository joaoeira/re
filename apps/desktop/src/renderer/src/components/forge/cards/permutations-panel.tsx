import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useForgeGeneratePermutationsMutation } from "@/hooks/mutations/use-forge-cards-mutations";
import { useForgeCardPermutationsQuery } from "@/hooks/queries/use-forge-card-permutations-query";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query-keys";

type PermutationsPanelProps = {
  readonly sourceCardId: number;
};

export function PermutationsPanel({ sourceCardId }: PermutationsPanelProps) {
  const queryClient = useQueryClient();
  const permutationsQuery = useForgeCardPermutationsQuery(sourceCardId);
  const { mutate: regeneratePermutations, isPending } = useForgeGeneratePermutationsMutation();
  const [addedIds, setAddedIds] = useState<ReadonlySet<number>>(new Set());
  const autoRegeneratedCardIdRef = useRef<number | null>(null);

  const loading = isPending || permutationsQuery.isLoading;
  const permutations = permutationsQuery.data?.permutations ?? [];

  const handleRegenerate = useCallback(() => {
    regeneratePermutations(
      { sourceCardId },
      {
        onSuccess: (result) => {
          queryClient.setQueryData(queryKeys.forgeCardPermutations(sourceCardId), () => result);
          setAddedIds(new Set());
        },
      },
    );
  }, [queryClient, regeneratePermutations, sourceCardId]);

  useEffect(() => {
    autoRegeneratedCardIdRef.current = null;
  }, [sourceCardId]);

  useEffect(() => {
    if (!permutationsQuery.isSuccess) return;
    if (permutations.length > 0) return;
    if (isPending) return;
    if (autoRegeneratedCardIdRef.current === sourceCardId) return;
    autoRegeneratedCardIdRef.current = sourceCardId;
    handleRegenerate();
  }, [handleRegenerate, isPending, permutations.length, permutationsQuery.isSuccess, sourceCardId]);

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
            {permutations.length} variations generated
          </span>
        )}
        {!loading && (
          <button
            type="button"
            onClick={handleRegenerate}
            className="text-[11px] text-muted-foreground/40 underline decoration-border underline-offset-4 transition-colors hover:text-foreground/60"
          >
            regenerate
          </button>
        )}
      </div>

      {permutationsQuery.error ? (
        <p className="text-[11px] text-destructive">{permutationsQuery.error.message}</p>
      ) : null}

      {!loading &&
        permutations.map((permutation) => (
          <div
            key={permutation.id}
            className="flex items-start gap-3 border-b border-border/20 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed text-foreground/70">
                {permutation.question}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground/60">
                {permutation.answer}
              </p>
            </div>
            {addedIds.has(permutation.id) ? (
              <span className="shrink-0 pt-0.5 text-[11px] text-primary">✓</span>
            ) : (
              <Button
                type="button"
                variant="default"
                size="xs"
                className="shrink-0"
                onClick={() => setAddedIds((prev) => new Set([...prev, permutation.id]))}
              >
                + Add
              </Button>
            )}
          </div>
        ))}
    </div>
  );
}
