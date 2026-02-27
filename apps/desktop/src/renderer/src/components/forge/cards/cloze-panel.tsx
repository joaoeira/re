import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ClozePreview } from "@/components/editor/cloze-preview";
import { useForgeGenerateClozeMutation } from "@/hooks/mutations/use-forge-cards-mutations";
import { useForgeCardClozeQuery } from "@/hooks/queries/use-forge-card-cloze-query";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";

type ClozePanelProps = {
  readonly sourceCardId: number;
};

export function ClozePanel({ sourceCardId }: ClozePanelProps) {
  const queryClient = useQueryClient();
  const clozeQuery = useForgeCardClozeQuery(sourceCardId);
  const { mutate: regenerateCloze, isPending } = useForgeGenerateClozeMutation();
  const [added, setAdded] = useState(false);
  const autoRegeneratedCardIdRef = useRef<number | null>(null);

  const loading = isPending || clozeQuery.isLoading;
  const clozeText = clozeQuery.data?.cloze ?? null;

  const handleRegenerate = useCallback(() => {
    regenerateCloze(
      { sourceCardId },
      {
        onSuccess: (result) => {
          queryClient.setQueryData(queryKeys.forgeCardCloze(sourceCardId), () => result);
          setAdded(false);
        },
      },
    );
  }, [queryClient, regenerateCloze, sourceCardId]);

  useEffect(() => {
    autoRegeneratedCardIdRef.current = null;
  }, [sourceCardId]);

  useEffect(() => {
    if (!clozeQuery.isSuccess) return;
    if (clozeText !== null) return;
    if (isPending) return;
    if (autoRegeneratedCardIdRef.current === sourceCardId) return;
    autoRegeneratedCardIdRef.current = sourceCardId;
    handleRegenerate();
  }, [clozeQuery.isSuccess, clozeText, handleRegenerate, isPending, sourceCardId]);

  return (
    <div className="mt-3 border-t border-dashed border-border/40 pt-3">
      {loading ? (
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
          <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
          Converting to cloze…
        </span>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40">Cloze conversion</span>
            <button
              type="button"
              onClick={handleRegenerate}
              className="text-[11px] text-muted-foreground/40 underline decoration-border underline-offset-4 transition-colors hover:text-foreground/60"
            >
              regenerate
            </button>
          </div>

          {clozeQuery.error ? (
            <p className="text-[11px] text-destructive">{clozeQuery.error.message}</p>
          ) : null}

          {clozeText ? (
            <div className="bg-muted/20 px-4 py-3">
              <ClozePreview content={clozeText} />
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/50">No cloze generated yet.</p>
          )}

          <div className="mt-3">
            {added ? (
              <span className="text-[11px] text-primary">✓ Added to deck</span>
            ) : (
              <Button type="button" variant="secondary" size="xs" onClick={() => setAdded(true)}>
                + Add to deck
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
