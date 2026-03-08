import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";

import {
  type ForgeGenerateDerivedCardsMutationInput,
  forgeCardsMutationKeys,
  formatQAContent,
  isForgeDerivationConfirmationResult,
  sameDerivationParentRef,
  useForgeAddCardToDeckMutation,
  useForgeGenerateDerivedCardsMutation,
  useForgeUpdateDerivationMutation,
} from "@/hooks/mutations/use-forge-cards-mutations";
import { useForgeDerivedCardsQuery } from "@/hooks/queries/use-forge-derived-cards-query";
import { queryKeys } from "@/lib/query-keys";
import {
  toDerivationParentRefKey,
  type DerivationParentRef,
  type ForgeGetDerivedCardsResult,
} from "@shared/rpc/schemas/forge";
import { Button } from "@/components/ui/button";
import { useForgeTargetDeckPath } from "../forge-page-context";

import { InlineEditor } from "./inline-editor";

type PermutationsPanelProps = {
  readonly parent: DerivationParentRef;
  readonly rootCardId: number;
};

const confirmReplacement = (descendantCount: number): boolean =>
  window.confirm(
    `Regenerating these cards will delete ${descendantCount} descendant card${descendantCount === 1 ? "" : "s"}. Continue?`,
  );

export function PermutationsPanel({ parent, rootCardId }: PermutationsPanelProps) {
  const derivationsQuery = useForgeDerivedCardsQuery(rootCardId, parent, "permutation");
  const { mutateAsync: generateDerivedCards, isPending } = useForgeGenerateDerivedCardsMutation();
  const { mutate: updateDerivation } = useForgeUpdateDerivationMutation();
  const { mutate: addCardToDeck } = useForgeAddCardToDeckMutation();
  const targetDeckPath = useForgeTargetDeckPath();
  const queryClient = useQueryClient();
  const derivationsQueryKey = queryKeys.forgeDerivedCards(rootCardId, parent, "permutation");
  const derivationParentKey = `${toDerivationParentRefKey(parent)}:${rootCardId}:permutation`;
  const inFlightForParentCount = useIsMutating({
    mutationKey: forgeCardsMutationKeys.generateDerivedCards,
    predicate: (mutation) => {
      const variables = mutation.state.variables as
        | ForgeGenerateDerivedCardsMutationInput
        | undefined;
      return (
        variables?.kind === "permutation" &&
        variables.rootCardId === rootCardId &&
        sameDerivationParentRef(variables.parent, parent)
      );
    },
  });
  const [addingIds, setAddingIds] = useState<ReadonlySet<number>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [generationErrorMessage, setGenerationErrorMessage] = useState<string | null>(null);
  const autoRegeneratedParentKeyRef = useRef<string | null>(null);

  const hasInFlightGeneration = inFlightForParentCount > 0;
  const loading = isPending || hasInFlightGeneration || derivationsQuery.isLoading;
  const derivations = derivationsQuery.data?.derivations ?? [];
  const errorMessage = generationErrorMessage ?? derivationsQuery.error?.message ?? null;

  const requestRegeneration = useCallback(
    async (confirmed?: boolean) => {
      setGenerationErrorMessage(null);
      try {
        const result = await generateDerivedCards({
          rootCardId,
          parent,
          kind: "permutation",
          ...(confirmed ? { confirmed } : {}),
        });

        if (isForgeDerivationConfirmationResult(result)) {
          if (!confirmReplacement(result.descendantCount)) {
            return;
          }

          await generateDerivedCards({
            rootCardId,
            parent,
            kind: "permutation",
            confirmed: true,
          });
        }

        return;
      } catch (error) {
        setGenerationErrorMessage((error as Error).message);
        throw error;
      }
    },
    [generateDerivedCards, parent, rootCardId],
  );

  const handleEditDerivation = useCallback(
    (derivationId: number, field: "question" | "answer", value: string) => {
      const previous = queryClient.getQueryData<ForgeGetDerivedCardsResult>(derivationsQueryKey);
      const currentDerivation = previous?.derivations.find(
        (derivation) => derivation.id === derivationId,
      );
      if (!currentDerivation) return;

      const nextQuestion = field === "question" ? value : currentDerivation.question;
      const nextAnswer = field === "answer" ? value : currentDerivation.answer;

      queryClient.setQueryData(derivationsQueryKey, (current: typeof previous) => {
        if (!current) return current;
        return {
          ...current,
          derivations: current.derivations.map((derivation) =>
            derivation.id === derivationId
              ? { ...derivation, question: nextQuestion, answer: nextAnswer }
              : derivation,
          ),
        };
      });

      updateDerivation(
        { derivationId, question: nextQuestion, answer: nextAnswer },
        {
          onError: () => {
            queryClient.setQueryData(derivationsQueryKey, previous);
          },
          onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: derivationsQueryKey, exact: true });
          },
        },
      );
    },
    [derivationsQueryKey, queryClient, updateDerivation],
  );

  const handleAddDerivation = useCallback(
    (derivationId: number, question: string, answer: string) => {
      if (!targetDeckPath || addingIds.has(derivationId)) return;

      setAddingIds((prev) => new Set([...prev, derivationId]));
      setAddError(null);
      addCardToDeck(
        {
          deckPath: targetDeckPath,
          content: formatQAContent(question, answer),
          cardType: "qa",
          derivationId,
        },
        {
          onSuccess: (result) => {
            queryClient.setQueryData<ForgeGetDerivedCardsResult>(
              derivationsQueryKey,
              (previous) => {
                if (!previous) return previous;
                return {
                  ...previous,
                  derivations: previous.derivations.map((entry) =>
                    entry.id === derivationId
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
              next.delete(derivationId);
              return next;
            }),
        },
      );
    },
    [addCardToDeck, addingIds, derivationsQueryKey, queryClient, targetDeckPath],
  );

  useEffect(() => {
    autoRegeneratedParentKeyRef.current = null;
    setGenerationErrorMessage(null);
  }, [derivationParentKey]);

  useEffect(() => {
    if (!derivationsQuery.isSuccess) return;
    if (derivationsQuery.isFetching) return;
    if (derivations.length > 0) return;
    if (hasInFlightGeneration) return;

    if (autoRegeneratedParentKeyRef.current === derivationParentKey) return;

    autoRegeneratedParentKeyRef.current = derivationParentKey;
    void requestRegeneration().catch(() => undefined);
  }, [
    derivationParentKey,
    derivations.length,
    derivationsQuery.isFetching,
    derivationsQuery.isSuccess,
    hasInFlightGeneration,
    requestRegeneration,
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
            {derivations.length} variations generated
          </span>
        )}
        {!loading && (
          <button
            type="button"
            onClick={() => void requestRegeneration().catch(() => undefined)}
            className="text-[11px] text-muted-foreground/40 underline decoration-border underline-offset-4 transition-colors hover:text-foreground/60"
          >
            regenerate
          </button>
        )}
      </div>

      {errorMessage ? <p className="text-[11px] text-destructive">{errorMessage}</p> : null}

      {addError ? <p className="mb-2 text-[11px] text-destructive">{addError}</p> : null}

      {!loading &&
        derivations.map((derivation) => (
          <div
            key={derivation.id}
            className="flex items-start gap-3 border-b border-border/20 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <InlineEditor
                content={derivation.question}
                editable
                onContentChange={(value) => handleEditDerivation(derivation.id, "question", value)}
                className="min-h-0 text-[13px] leading-relaxed text-foreground/70"
              />
              <InlineEditor
                content={derivation.answer}
                editable
                onContentChange={(value) => handleEditDerivation(derivation.id, "answer", value)}
                className="mt-1 min-h-0 text-xs leading-relaxed text-muted-foreground/60"
              />
            </div>
            {derivation.addedCount > 0 ? (
              <span className="shrink-0 pt-0.5 text-[11px] text-primary">✓</span>
            ) : (
              <Button
                type="button"
                variant="default"
                size="xs"
                className="shrink-0"
                disabled={addingIds.has(derivation.id) || !targetDeckPath}
                onClick={() =>
                  handleAddDerivation(derivation.id, derivation.question, derivation.answer)
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
