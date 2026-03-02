import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";

import {
  forgeCardsMutationKeys,
  formatQAContent,
  useForgeAddCardToDeckMutation,
  useForgeGeneratePermutationsMutation,
  useForgeUpdatePermutationMutation,
} from "@/hooks/mutations/use-forge-cards-mutations";
import { useForgeCardPermutationsQuery } from "@/hooks/queries/use-forge-card-permutations-query";
import { queryKeys } from "@/lib/query-keys";
import type {
  ForgeGenerateCardPermutationsInput,
  ForgeGetCardPermutationsResult,
} from "@shared/rpc/schemas/forge";
import { Button } from "@/components/ui/button";
import { useForgeTargetDeckPath } from "../forge-page-context";

import { InlineEditor } from "./inline-editor";

type PermutationsPanelProps = {
  readonly sourceCardId: number;
  readonly sourceQuestion: string;
  readonly sourceAnswer: string;
};

export function PermutationsPanel({
  sourceCardId,
  sourceQuestion,
  sourceAnswer,
}: PermutationsPanelProps) {
  const permutationsQuery = useForgeCardPermutationsQuery(sourceCardId);
  const { mutate: regeneratePermutations, isPending } = useForgeGeneratePermutationsMutation();
  const { mutate: updatePermutation } = useForgeUpdatePermutationMutation();
  const { mutate: addCardToDeck } = useForgeAddCardToDeckMutation();
  const targetDeckPath = useForgeTargetDeckPath();
  const queryClient = useQueryClient();
  const permutationsQueryKey = queryKeys.forgeCardPermutations(sourceCardId);
  const inFlightForSourceCardCount = useIsMutating({
    mutationKey: forgeCardsMutationKeys.generatePermutations,
    predicate: (mutation) => {
      const variables = mutation.state.variables as ForgeGenerateCardPermutationsInput | undefined;
      return variables?.sourceCardId === sourceCardId;
    },
  });
  const [addingIds, setAddingIds] = useState<ReadonlySet<number>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const autoRegeneratedCardIdRef = useRef<number | null>(null);

  const hasInFlightGeneration = inFlightForSourceCardCount > 0;
  const loading = isPending || hasInFlightGeneration || permutationsQuery.isLoading;
  const permutations = permutationsQuery.data?.permutations ?? [];

  const handleRegenerate = useCallback(() => {
    regeneratePermutations({
      sourceCardId,
      sourceQuestion,
      sourceAnswer,
    });
  }, [regeneratePermutations, sourceAnswer, sourceCardId, sourceQuestion]);

  const handleEditPermutation = useCallback(
    (permutationId: number, field: "question" | "answer", value: string) => {
      const previous =
        queryClient.getQueryData<ForgeGetCardPermutationsResult>(permutationsQueryKey);

      const currentPermutation = previous?.permutations.find((p) => p.id === permutationId);
      if (!currentPermutation) return;

      const nextQuestion = field === "question" ? value : currentPermutation.question;
      const nextAnswer = field === "answer" ? value : currentPermutation.answer;

      queryClient.setQueryData(permutationsQueryKey, (current: typeof previous) => {
        if (!current) return current;
        return {
          ...current,
          permutations: current.permutations.map((p) =>
            p.id === permutationId ? { ...p, question: nextQuestion, answer: nextAnswer } : p,
          ),
        };
      });

      updatePermutation(
        { permutationId, question: nextQuestion, answer: nextAnswer },
        {
          onError: () => {
            queryClient.setQueryData(permutationsQueryKey, previous);
          },
          onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: permutationsQueryKey, exact: true });
          },
        },
      );
    },
    [permutationsQueryKey, queryClient, updatePermutation],
  );

  const handleAddPermutation = useCallback(
    (permutationId: number, question: string, answer: string) => {
      if (!targetDeckPath || addingIds.has(permutationId)) return;

      setAddingIds((prev) => new Set([...prev, permutationId]));
      setAddError(null);
      addCardToDeck(
        {
          deckPath: targetDeckPath,
          content: formatQAContent(question, answer),
          cardType: "qa",
          permutationId,
        },
        {
          onSuccess: (result) => {
            queryClient.setQueryData<ForgeGetCardPermutationsResult>(
              permutationsQueryKey,
              (previous) => {
                if (!previous) return previous;
                return {
                  ...previous,
                  permutations: previous.permutations.map((entry) =>
                    entry.id === permutationId
                      ? {
                          ...entry,
                          addedCount: entry.addedCount + result.cardIds.length,
                        }
                      : entry,
                  ),
                };
              },
            );
          },
          onError: (error) => setAddError(error.message),
          onSettled: () =>
            setAddingIds((prev) => {
              const next = new Set(prev);
              next.delete(permutationId);
              return next;
            }),
        },
      );
    },
    [addCardToDeck, addingIds, permutationsQueryKey, queryClient, targetDeckPath],
  );

  useEffect(() => {
    autoRegeneratedCardIdRef.current = null;
  }, [sourceCardId]);

  useEffect(() => {
    if (!permutationsQuery.isSuccess) return;
    if (permutationsQuery.isFetching) return;
    if (permutations.length > 0) return;
    if (hasInFlightGeneration) return;
    if (autoRegeneratedCardIdRef.current === sourceCardId) return;

    autoRegeneratedCardIdRef.current = sourceCardId;
    handleRegenerate();
  }, [
    handleRegenerate,
    hasInFlightGeneration,
    permutations.length,
    permutationsQuery.isSuccess,
    permutationsQuery.isFetching,
    sourceCardId,
  ]);

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

      {addError ? <p className="mb-2 text-[11px] text-destructive">{addError}</p> : null}

      {!loading &&
        permutations.map((permutation) => (
          <div
            key={permutation.id}
            className="flex items-start gap-3 border-b border-border/20 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <InlineEditor
                content={permutation.question}
                editable
                onContentChange={(value) =>
                  handleEditPermutation(permutation.id, "question", value)
                }
                className="min-h-0 text-[13px] leading-relaxed text-foreground/70"
              />
              <InlineEditor
                content={permutation.answer}
                editable
                onContentChange={(value) => handleEditPermutation(permutation.id, "answer", value)}
                className="mt-1 min-h-0 text-xs leading-relaxed text-muted-foreground/60"
              />
            </div>
            {permutation.addedCount > 0 ? (
              <span className="shrink-0 pt-0.5 text-[11px] text-primary">
                ✓ {permutation.addedCount}
              </span>
            ) : (
              <Button
                type="button"
                variant="default"
                size="xs"
                className="shrink-0"
                disabled={addingIds.has(permutation.id) || !targetDeckPath}
                onClick={() =>
                  handleAddPermutation(permutation.id, permutation.question, permutation.answer)
                }
              >
                + Add
              </Button>
            )}
          </div>
        ))}
    </div>
  );
}
