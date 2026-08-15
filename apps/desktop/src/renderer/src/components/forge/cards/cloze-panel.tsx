import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { nextClozeDeletionIndex, parseClozeDeletions } from "@re/core";

import { ClozePreview } from "@/components/editor/cloze-preview";
import {
  forgeCardsMutationKeys,
  useForgeAddCardToDeckMutation,
  useForgeGenerateClozeMutation,
} from "@/hooks/mutations/use-forge-cards-mutations";
import { useForgeCardClozeQuery } from "@/hooks/queries/use-forge-card-cloze-query";
import { queryKeys } from "@/lib/query-keys";
import {
  sameDerivationParentRef,
  toDerivationParentRefKey,
  type DerivationParentRef,
  type ForgeGenerateCardClozeInput,
  type ForgeGetCardClozeResult,
} from "@shared/rpc/schemas/forge";
import { Button } from "@/components/ui/button";
import { useForgeTargetDeckPath } from "../forge-page-context";

type ClozePanelProps = {
  readonly source: DerivationParentRef;
  readonly sourceQuestion: string;
  readonly sourceAnswer: string;
};

const wrapSelectedTextAsNextCloze = (
  content: string,
  selectionStart: number,
  selectionEnd: number,
): { readonly content: string; readonly caret: number } | null => {
  if (selectionStart === selectionEnd) return null;

  const selectedText = content.slice(selectionStart, selectionEnd);
  if (selectedText.trim().length === 0) return null;

  const overlapsExistingCloze = parseClozeDeletions(content).some(
    (deletion) => selectionStart < deletion.end && selectionEnd > deletion.start,
  );
  if (overlapsExistingCloze) return null;

  const replacement = `{{c${nextClozeDeletionIndex(content)}::${selectedText}}}`;
  return {
    content: `${content.slice(0, selectionStart)}${replacement}${content.slice(selectionEnd)}`,
    caret: selectionStart + replacement.length,
  };
};

export function ClozePanel({ source, sourceQuestion, sourceAnswer }: ClozePanelProps) {
  const clozeQuery = useForgeCardClozeQuery(source);
  const { mutate: regenerateCloze, isPending } = useForgeGenerateClozeMutation();
  const { mutate: addCardToDeck } = useForgeAddCardToDeckMutation();
  const queryClient = useQueryClient();
  const targetDeckPath = useForgeTargetDeckPath();
  const stableSourceKey = toDerivationParentRefKey(source);
  const inFlightForSourceCount = useIsMutating({
    mutationKey: forgeCardsMutationKeys.generateCloze,
    predicate: (mutation) => {
      const variables = mutation.state.variables as ForgeGenerateCardClozeInput | undefined;
      if (!variables) return false;
      return sameDerivationParentRef(variables.source, source);
    },
  });
  const [addingCloze, setAddingCloze] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [generationErrorMessage, setGenerationErrorMessage] = useState<string | null>(null);
  const [clozeDraft, setClozeDraft] = useState<string | null>(null);
  const autoRegeneratedSourceKeyRef = useRef<string | null>(null);

  const hasInFlightGeneration = inFlightForSourceCount > 0;
  const loading = isPending || hasInFlightGeneration || clozeQuery.isLoading;
  const generatedClozeText = clozeQuery.data?.cloze ?? null;
  const clozeText = clozeDraft ?? generatedClozeText;
  const addedCount = clozeQuery.data?.addedCount ?? 0;
  const hasBeenAdded = addedCount > 0;
  const hasValidCloze = clozeText !== null && parseClozeDeletions(clozeText).length > 0;
  const errorMessage = generationErrorMessage ?? clozeQuery.error?.message ?? null;

  const wrapTextareaSelection = useCallback((textarea: HTMLTextAreaElement) => {
    const wrapped = wrapSelectedTextAsNextCloze(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (!wrapped) return;

    setClozeDraft(wrapped.content);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(wrapped.caret, wrapped.caret);
    });
  }, []);

  const handleRegenerate = useCallback(() => {
    setGenerationErrorMessage(null);
    regenerateCloze(
      {
        source,
        sourceQuestion,
        sourceAnswer,
      },
      {
        onError: (error) => {
          setGenerationErrorMessage(error.message);
        },
      },
    );
  }, [regenerateCloze, source, sourceAnswer, sourceQuestion]);

  const handleAddCloze = useCallback(() => {
    if (!targetDeckPath || !clozeText || addingCloze) return;

    setAddingCloze(true);
    setAddError(null);
    addCardToDeck(
      {
        deckPath: targetDeckPath,
        content: clozeText,
        cardType: "cloze",
        ...("cardId" in source
          ? { sourceCardId: source.cardId }
          : { derivationId: source.derivationId }),
      },
      {
        onSuccess: (result) => {
          queryClient.setQueryData<ForgeGetCardClozeResult>(
            queryKeys.forgeCardCloze(source),
            (previous) => {
              if (!previous) return previous;
              return {
                ...previous,
                addedCount: previous.addedCount + result.cardIds.length,
              };
            },
          );
        },
        onError: (error) => setAddError(error.message),
        onSettled: () => setAddingCloze(false),
      },
    );
  }, [addCardToDeck, addingCloze, clozeText, queryClient, source, targetDeckPath]);

  useEffect(() => {
    autoRegeneratedSourceKeyRef.current = null;
    setGenerationErrorMessage(null);
    setClozeDraft(null);
  }, [stableSourceKey]);

  useEffect(() => {
    setClozeDraft(generatedClozeText);
  }, [generatedClozeText]);

  useEffect(() => {
    if (!clozeQuery.isSuccess) return;
    if (clozeQuery.isFetching) return;
    if (generatedClozeText !== null) return;
    if (hasInFlightGeneration) return;

    if (autoRegeneratedSourceKeyRef.current === stableSourceKey) return;

    autoRegeneratedSourceKeyRef.current = stableSourceKey;
    handleRegenerate();
  }, [
    clozeQuery.isFetching,
    clozeQuery.isSuccess,
    generatedClozeText,
    handleRegenerate,
    hasInFlightGeneration,
    stableSourceKey,
  ]);

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

          {errorMessage ? <p className="text-[11px] text-destructive">{errorMessage}</p> : null}

          {addError ? <p className="text-[11px] text-destructive">{addError}</p> : null}

          {clozeText !== null ? (
            <div className="bg-muted/20 px-4 py-3">
              <label
                htmlFor={`cloze-editor-${stableSourceKey}`}
                className="mb-2 block text-[11px] text-muted-foreground/50"
              >
                Select text to turn it into the next cloze, or edit the text directly.
              </label>
              <textarea
                id={`cloze-editor-${stableSourceKey}`}
                aria-label="Editable cloze text"
                value={clozeText}
                rows={3}
                disabled={addingCloze || hasBeenAdded}
                onChange={(event) => setClozeDraft(event.target.value)}
                onMouseUp={(event) => wrapTextareaSelection(event.currentTarget)}
                onTouchEnd={(event) => wrapTextareaSelection(event.currentTarget)}
                onKeyUp={(event) => {
                  if (event.key === "Shift") {
                    wrapTextareaSelection(event.currentTarget);
                  }
                }}
                className="w-full resize-y bg-transparent text-sm leading-relaxed text-foreground/80 outline-none placeholder:text-muted-foreground/40 disabled:cursor-not-allowed disabled:opacity-60"
              />
              {hasValidCloze ? (
                <div className="mt-3 border-t border-border/30 pt-3">
                  <ClozePreview content={clozeText} />
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground/50">
                  Select some text to create at least one cloze.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/50">No cloze generated yet.</p>
          )}

          <div className="mt-3">
            {hasBeenAdded ? (
              <span className="text-[11px] text-primary">
                ✓ Added to deck ({addedCount} card{addedCount === 1 ? "" : "s"})
              </span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                disabled={addingCloze || !targetDeckPath || !hasValidCloze}
                onClick={handleAddCloze}
              >
                + Add to deck
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
