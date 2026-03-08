import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Braces, ListTree, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import type { DerivationParentRef, ForgeGetDerivedCardsResult } from "@shared/rpc/schemas/forge";
import { useForgeTargetDeckPath } from "../forge-page-context";
import type { ExpansionColumnDescriptor } from "../forge-page-store";

import { ClozePanel } from "./cloze-panel";
import { InlineEditor } from "./inline-editor";
import { PermutationsPanel } from "./permutations-panel";

type ExpansionColumnProps = {
  readonly topicKey: string;
  readonly column: ExpansionColumnDescriptor;
  readonly expandedDerivationIds: ReadonlySet<number>;
  readonly onClose: () => void;
  readonly onRegenerated: () => void;
  readonly onRequestExpansion: (
    descriptor: ExpansionColumnDescriptor,
    sourceColumnParent: DerivationParentRef,
  ) => void;
};

const confirmReplacement = (descendantCount: number): boolean =>
  window.confirm(
    `Regenerating these cards will delete ${descendantCount} descendant card${descendantCount === 1 ? "" : "s"}. Continue?`,
  );

type ExpandedPanelMap = ReadonlyMap<number, "permutations" | "cloze">;

export function ExpansionColumn({
  topicKey: _topicKey,
  column,
  expandedDerivationIds,
  onClose,
  onRegenerated,
  onRequestExpansion,
}: ExpansionColumnProps) {
  const queryClient = useQueryClient();
  const targetDeckPath = useForgeTargetDeckPath();
  const query = useForgeDerivedCardsQuery(column.rootCardId, column.parent, "expansion");
  const { mutateAsync: generateDerivedCards, isPending } = useForgeGenerateDerivedCardsMutation();
  const { mutate: updateDerivation } = useForgeUpdateDerivationMutation();
  const { mutate: addCardToDeck } = useForgeAddCardToDeckMutation();
  const queryKey = queryKeys.forgeDerivedCards(column.rootCardId, column.parent, "expansion");
  const inFlightForColumnCount = useIsMutating({
    mutationKey: forgeCardsMutationKeys.generateDerivedCards,
    predicate: (mutation) => {
      const variables = mutation.state.variables as
        | ForgeGenerateDerivedCardsMutationInput
        | undefined;
      return (
        variables?.kind === "expansion" &&
        variables.rootCardId === column.rootCardId &&
        sameDerivationParentRef(variables.parent, column.parent)
      );
    },
  });

  const [instruction, setInstruction] = useState(column.instruction ?? "");
  const [expandedPanels, setExpandedPanels] = useState<ExpandedPanelMap>(new Map());
  const [addingIds, setAddingIds] = useState<ReadonlySet<number>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);
  const [generationErrorMessage, setGenerationErrorMessage] = useState<string | null>(null);

  const derivations = query.data?.derivations ?? [];
  const loading = isPending || inFlightForColumnCount > 0 || query.isLoading;
  const resolvedInstruction = derivations[0]?.instruction ?? column.instruction ?? "";
  const errorMessage = generationErrorMessage ?? query.error?.message ?? null;

  useEffect(() => {
    if (!instruction && resolvedInstruction) {
      setInstruction(resolvedInstruction);
    }
  }, [instruction, resolvedInstruction]);

  useEffect(() => {
    setGenerationErrorMessage(null);
  }, [column.id]);

  const requestGeneration = useCallback(
    async (confirmed?: boolean) => {
      setGenerationErrorMessage(null);
      try {
        const result = await generateDerivedCards({
          rootCardId: column.rootCardId,
          parent: column.parent,
          kind: "expansion",
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
          ...(confirmed ? { confirmed } : {}),
        });

        if (isForgeDerivationConfirmationResult(result)) {
          if (!confirmReplacement(result.descendantCount)) {
            return;
          }

          await generateDerivedCards({
            rootCardId: column.rootCardId,
            parent: column.parent,
            kind: "expansion",
            ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
            confirmed: true,
          });
        }

        onRegenerated();
        return;
      } catch (error) {
        setGenerationErrorMessage((error as Error).message);
        throw error;
      }
    },
    [column.parent, column.rootCardId, generateDerivedCards, instruction, onRegenerated],
  );

  const togglePanel = useCallback((derivationId: number, panel: "permutations" | "cloze") => {
    setExpandedPanels((current) => {
      const next = new Map(current);
      const existing = next.get(derivationId) ?? null;
      if (existing === panel) {
        next.delete(derivationId);
      } else {
        next.set(derivationId, panel);
      }
      return next;
    });
  }, []);

  const handleEditDerivation = useCallback(
    (derivationId: number, field: "question" | "answer", value: string) => {
      const previous = queryClient.getQueryData<ForgeGetDerivedCardsResult>(queryKey);
      const currentDerivation = previous?.derivations.find(
        (derivation) => derivation.id === derivationId,
      );
      if (!currentDerivation) return;

      const nextQuestion = field === "question" ? value : currentDerivation.question;
      const nextAnswer = field === "answer" ? value : currentDerivation.answer;

      queryClient.setQueryData(queryKey, (current: typeof previous) => {
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
            queryClient.setQueryData(queryKey, previous);
          },
          onSettled: () => {
            void queryClient.invalidateQueries({ queryKey, exact: true });
          },
        },
      );
    },
    [queryClient, queryKey, updateDerivation],
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
            queryClient.setQueryData<ForgeGetDerivedCardsResult>(queryKey, (previous) => {
              if (!previous) return previous;
              return {
                ...previous,
                derivations: previous.derivations.map((entry) =>
                  entry.id === derivationId
                    ? { ...entry, addedCount: entry.addedCount + result.cardIds.length }
                    : entry,
                ),
              };
            });
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
    [addCardToDeck, addingIds, queryClient, queryKey, targetDeckPath],
  );

  const headerLabel = useMemo(() => {
    if (loading || derivations.length > 0) return "EXPANDED FROM";
    return "EXPANDING";
  }, [derivations.length, loading]);

  return (
    <section className="min-h-0 w-[760px] shrink-0 overflow-y-auto border-l border-border/30">
      <div className="px-12 py-7 pb-20">
        <div className="mb-4 border border-border bg-muted/20 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
              {headerLabel}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-1 size-7"
              onClick={onClose}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <p className="mt-2 text-[15px] leading-relaxed text-foreground/80">
            {column.parentQuestion}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {column.parentAnswer}
          </p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground/40">
            {resolvedInstruction ? <span className="italic">"{resolvedInstruction}"</span> : null}
            {derivations.length > 0 ? (
              <>
                {resolvedInstruction ? <span className="text-border">·</span> : null}
                <span>{derivations.length} cards</span>
                <span className="text-border">·</span>
                <button
                  type="button"
                  onClick={() => void requestGeneration().catch(() => undefined)}
                  className="text-muted-foreground/50 underline decoration-border underline-offset-4 transition-colors hover:text-foreground/60"
                >
                  regenerate
                </button>
              </>
            ) : null}
          </div>
        </div>

        {errorMessage && derivations.length === 0 ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-[12px] text-destructive">{errorMessage}</p>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-3"
              onClick={() => void requestGeneration().catch(() => undefined)}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {!loading && derivations.length === 0 ? (
          <div className="mt-6">
            <input
              type="text"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              className="w-full bg-transparent text-sm text-foreground/80 outline-none placeholder:text-muted-foreground/40"
              placeholder="What should these cards focus on?"
            />
            <button
              type="button"
              className="mt-5 flex items-center gap-1.5 text-[13px] text-muted-foreground/40 transition-colors hover:text-foreground/60"
              onClick={() => void requestGeneration().catch(() => undefined)}
            >
              ✦ Generate cards
              <kbd className="ml-1 text-[11px] text-muted-foreground/25">⌘↵</kbd>
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-4">
            <p className="text-[12px] text-muted-foreground/40">Generating cards...</p>
            <div className="mt-4 space-y-5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div
                    className="h-2.5 animate-pulse rounded bg-muted/40"
                    style={{ width: `${90 - i * 7}%` }}
                  />
                  <div
                    className="h-2.5 animate-pulse rounded bg-muted/25"
                    style={{ width: `${72 - i * 5}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {errorMessage && derivations.length > 0 ? (
          <p className="mt-4 text-[11px] text-destructive">{errorMessage}</p>
        ) : null}

        {addError ? <p className="mt-4 text-[11px] text-destructive">{addError}</p> : null}

        {derivations.length > 0 ? (
          <>
            <div>
              {derivations.map((derivation) => {
                const expandedPanel = expandedPanels.get(derivation.id) ?? null;
                const isExpanded = expandedDerivationIds.has(derivation.id);

                return (
                  <div
                    key={derivation.id}
                    className={cn(
                      "border-b border-border/20 py-4 last:border-b-0",
                      isExpanded && "bg-muted/35",
                    )}
                  >
                    <InlineEditor
                      content={derivation.question}
                      editable
                      onContentChange={(value) =>
                        handleEditDerivation(derivation.id, "question", value)
                      }
                      className="min-h-0 text-[14px] font-medium leading-relaxed"
                    />
                    <InlineEditor
                      content={derivation.answer}
                      editable
                      onContentChange={(value) =>
                        handleEditDerivation(derivation.id, "answer", value)
                      }
                      className="mt-1.5 min-h-0 text-sm leading-relaxed text-muted-foreground"
                    />

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        disabled={addingIds.has(derivation.id) || !targetDeckPath}
                        onClick={() =>
                          handleAddDerivation(derivation.id, derivation.question, derivation.answer)
                        }
                      >
                        {derivation.addedCount > 0 ? "Added" : "+ Add to deck"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="gap-1.5"
                        onClick={() => togglePanel(derivation.id, "permutations")}
                      >
                        <ListTree className="size-3" />
                        Permutations
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="gap-1.5"
                        onClick={() => togglePanel(derivation.id, "cloze")}
                      >
                        <Braces className="size-3" />
                        Cloze
                      </Button>
                      <Button
                        type="button"
                        variant={isExpanded ? "secondary" : "ghost"}
                        size="xs"
                        className={cn(
                          "gap-1.5",
                          !isExpanded &&
                            "text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
                        )}
                        onClick={() =>
                          onRequestExpansion(
                            {
                              id: `derivation:${derivation.id}`,
                              parent: { derivationId: derivation.id },
                              rootCardId: derivation.rootCardId,
                              parentQuestion: derivation.question,
                              parentAnswer: derivation.answer,
                              ...(derivation.instruction
                                ? { instruction: derivation.instruction }
                                : {}),
                            },
                            column.parent,
                          )
                        }
                      >
                        <ArrowRight className="size-3" />
                        {isExpanded ? "Expanded" : "Expand"}
                      </Button>
                    </div>

                    {expandedPanel === "permutations" ? (
                      <PermutationsPanel
                        parent={{ derivationId: derivation.id }}
                        rootCardId={column.rootCardId}
                      />
                    ) : null}

                    {expandedPanel === "cloze" ? (
                      <ClozePanel
                        source={{ derivationId: derivation.id }}
                        sourceQuestion={derivation.question}
                        sourceAnswer={derivation.answer}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
