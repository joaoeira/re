import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import { InlineEditor } from "@/components/forge/cards/inline-editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppendItemMutation } from "@/hooks/mutations/use-append-item-mutation";
import { useReviewGeneratePermutationsMutation } from "@/hooks/mutations/use-review-generate-permutations-mutation";
import { useReviewAssistantSourceCardQuery } from "@/hooks/queries/use-review-assistant-source-card-query";
import type { ReviewAssistantCardRef } from "@/lib/review-assistant";
import { buildEditorContent } from "@shared/state/editor-utils";
import type { ReviewGeneratedPermutation } from "@shared/rpc/schemas/review";

type ReviewPermutationsSidebarProps = {
  readonly card: ReviewAssistantCardRef;
  readonly cardKey: string;
  readonly onClose: () => void;
};

export const ReviewPermutationsSidebar = forwardRef<HTMLDivElement, ReviewPermutationsSidebarProps>(
  function ReviewPermutationsSidebar({ card, cardKey, onClose }, ref) {
    const sourceCardQuery = useReviewAssistantSourceCardQuery(card);
    const { mutate: generatePermutations, isPending: generating } =
      useReviewGeneratePermutationsMutation();
    const { mutate: appendItem } = useAppendItemMutation();
    const [rows, setRows] = useState<ReadonlyArray<ReviewGeneratedPermutation>>([]);
    const [generationError, setGenerationError] = useState<string | null>(null);
    const [addingRowIds, setAddingRowIds] = useState<ReadonlySet<string>>(new Set());
    const [addedRowIds, setAddedRowIds] = useState<ReadonlySet<string>>(new Set());
    const [appendErrorByRowId, setAppendErrorByRowId] = useState<ReadonlyMap<string, string>>(
      new Map(),
    );
    const activeGenerationRequestRef = useRef<{
      readonly cardKey: string;
      readonly requestId: string;
    } | null>(null);
    const autoGenerateAttemptedRef = useRef(false);

    useEffect(() => {
      setRows([]);
      setGenerationError(null);
      setAddingRowIds(new Set());
      setAddedRowIds(new Set());
      setAppendErrorByRowId(new Map());
      activeGenerationRequestRef.current = null;
      autoGenerateAttemptedRef.current = false;
    }, [cardKey]);

    const handleEditRow = useCallback(
      (rowId: string, field: "question" | "answer", value: string) => {
        setRows((current) =>
          current.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
        );
      },
      [],
    );

    const startGeneration = useCallback(() => {
      if (generating) return;

      const requestId = crypto.randomUUID();
      activeGenerationRequestRef.current = { cardKey, requestId };
      setGenerationError(null);
      setRows([]);
      setAddingRowIds(new Set());
      setAddedRowIds(new Set());
      setAppendErrorByRowId(new Map());

      generatePermutations(
        {
          deckPath: card.deckPath,
          cardId: card.cardId,
          cardIndex: card.cardIndex,
        },
        {
          onSuccess: (result) => {
            const activeRequest = activeGenerationRequestRef.current;
            if (
              !activeRequest ||
              activeRequest.cardKey !== cardKey ||
              activeRequest.requestId !== requestId
            ) {
              return;
            }

            setRows(result.permutations);
          },
          onError: (error) => {
            const activeRequest = activeGenerationRequestRef.current;
            if (
              !activeRequest ||
              activeRequest.cardKey !== cardKey ||
              activeRequest.requestId !== requestId
            ) {
              return;
            }

            setGenerationError(error.message);
          },
          onSettled: () => {
            const activeRequest = activeGenerationRequestRef.current;
            if (
              activeRequest &&
              activeRequest.cardKey === cardKey &&
              activeRequest.requestId === requestId
            ) {
              activeGenerationRequestRef.current = null;
            }
          },
        },
      );
    }, [card.cardId, card.cardIndex, card.deckPath, cardKey, generatePermutations, generating]);

    useEffect(() => {
      if (!sourceCardQuery.isSuccess) return;
      if (autoGenerateAttemptedRef.current) return;

      autoGenerateAttemptedRef.current = true;
      startGeneration();
    }, [sourceCardQuery.isSuccess, startGeneration]);

    const handleAddRow = useCallback(
      (rowId: string) => {
        const row = rows.find((entry) => entry.id === rowId);
        if (!row || addingRowIds.has(rowId) || addedRowIds.has(rowId)) {
          return;
        }

        const content = buildEditorContent({
          cardType: "qa",
          frontContent: row.question,
          backContent: row.answer,
        });
        if (!content) {
          setAppendErrorByRowId((current) => {
            const next = new Map(current);
            next.set(rowId, "Generated card content is empty.");
            return next;
          });
          return;
        }

        setAppendErrorByRowId((current) => {
          const next = new Map(current);
          next.delete(rowId);
          return next;
        });
        setAddingRowIds((current) => new Set([...current, rowId]));

        appendItem(
          {
            deckPath: card.deckPath,
            content,
            cardType: "qa",
          },
          {
            onSuccess: () => {
              setAddedRowIds((current) => new Set([...current, rowId]));
            },
            onError: (error) => {
              setAppendErrorByRowId((current) => {
                const next = new Map(current);
                next.set(rowId, error.message);
                return next;
              });
            },
            onSettled: () => {
              setAddingRowIds((current) => {
                const next = new Set(current);
                next.delete(rowId);
                return next;
              });
            },
          },
        );
      },
      [addedRowIds, addingRowIds, appendItem, card.deckPath, rows],
    );

    const sourceCard = sourceCardQuery.data?.sourceCard ?? null;

    return (
      <aside
        ref={ref}
        className="flex w-[380px] shrink-0 flex-col border-l border-border"
        aria-label="Permutations sidebar"
      >
        <div className="flex items-center justify-end px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close permutations sidebar"
          >
            ×
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="pb-4">
            {sourceCardQuery.isPending ? (
              <p className="text-[11px] text-muted-foreground/50">Loading source card...</p>
            ) : sourceCardQuery.isError ? (
              <p className="text-[11px] text-destructive">{sourceCardQuery.error.message}</p>
            ) : sourceCard ? (
              <div className="space-y-3 bg-muted/20 px-3 py-3">
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/40">
                    Question
                  </p>
                  <MarkdownRenderer content={sourceCard.content.question} />
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/40">
                    Answer
                  </p>
                  <MarkdownRenderer content={sourceCard.content.answer} />
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex items-center justify-between">
              {generating ? (
                <span className="flex items-center gap-2 text-[11px] text-muted-foreground/50">
                  <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
                  generating...
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground/40">
                  {rows.length} variations generated
                </span>
              )}
              {!generating && (
                <button
                  type="button"
                  disabled={!sourceCardQuery.isSuccess}
                  onClick={startGeneration}
                  className="text-[11px] text-muted-foreground/40 underline decoration-border underline-offset-4 transition-colors hover:text-foreground/60 disabled:pointer-events-none disabled:opacity-50"
                >
                  regenerate
                </button>
              )}
            </div>

            {generationError ? (
              <p className="mt-2 text-[11px] text-destructive">{generationError}</p>
            ) : null}
          </div>

          {rows.map((row) => (
            <div key={row.id} className="group relative border-b border-border/30 px-2 py-5">
              <div className={cn("transition-opacity", addedRowIds.has(row.id) && "opacity-40")}>
                <InlineEditor
                  content={row.question}
                  onContentChange={(value) => handleEditRow(row.id, "question", value)}
                  className="min-h-0 text-[15px] font-medium leading-relaxed"
                />
                <InlineEditor
                  content={row.answer}
                  onContentChange={(value) => handleEditRow(row.id, "answer", value)}
                  className="mt-1.5 min-h-0 text-sm leading-relaxed text-muted-foreground"
                />
              </div>

              {appendErrorByRowId.get(row.id) ? (
                <p className="mt-2 text-[11px] text-destructive">
                  {appendErrorByRowId.get(row.id)}
                </p>
              ) : null}

              <div className="mt-3 flex items-center gap-1.5 translate-y-0.5 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="gap-1.5"
                  disabled={addingRowIds.has(row.id) || addedRowIds.has(row.id)}
                  onClick={() => handleAddRow(row.id)}
                >
                  {addedRowIds.has(row.id) ? (
                    <Check className="size-3" />
                  ) : addingRowIds.has(row.id) ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  {addedRowIds.has(row.id) ? "Card added" : "Add to deck"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    );
  },
);
