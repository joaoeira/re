import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Braces, ListTree, Trash2, X } from "lucide-react";

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

import { AddToDeckButton } from "./add-to-deck-button";
import { ClozePanel } from "./cloze-panel";
import {
  ExpansionRegenerateDialogs,
  type PendingRegenerationConfirmation,
} from "./expansion-regenerate-dialogs";
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

type ExpandedPanelMap = ReadonlyMap<number, "permutations" | "cloze">;
type RequestGenerationInput = {
  readonly instructionText: string;
  readonly confirmed?: boolean;
};
type RequestGenerationResult =
  | { readonly status: "completed" }
  | { readonly status: "confirm_required"; readonly descendantCount: number };
type ExpansionColumnState = {
  readonly instruction: string;
  readonly hasInitializedInstruction: boolean;
  readonly regenerateDialogOpen: boolean;
  readonly regenerateInstructionDraft: string;
  readonly pendingRegenerationConfirmation: PendingRegenerationConfirmation | null;
  readonly expandedPanels: ExpandedPanelMap;
  readonly addingIds: ReadonlySet<number>;
  readonly deletedDerivationIds: ReadonlySet<number>;
  readonly addError: string | null;
  readonly generationErrorMessage: string | null;
};
type ExpansionColumnAction =
  | { readonly type: "reset"; readonly instruction: string }
  | { readonly type: "initializeInstruction"; readonly instruction: string }
  | { readonly type: "setInstruction"; readonly instruction: string }
  | { readonly type: "clearGenerationError" }
  | { readonly type: "setGenerationError"; readonly message: string }
  | { readonly type: "openRegenerateDialog"; readonly instruction: string }
  | { readonly type: "closeRegenerateDialog"; readonly instruction: string }
  | { readonly type: "setRegenerateInstructionDraft"; readonly instruction: string }
  | {
      readonly type: "setPendingRegenerationConfirmation";
      readonly confirmation: PendingRegenerationConfirmation | null;
    }
  | {
      readonly type: "togglePanel";
      readonly derivationId: number;
      readonly panel: "permutations" | "cloze";
    }
  | { readonly type: "startAdding"; readonly derivationId: number }
  | { readonly type: "finishAdding"; readonly derivationId: number }
  | { readonly type: "deleteDerivation"; readonly derivationId: number }
  | { readonly type: "setAddError"; readonly message: string | null };

const autoResizeTextarea = (textarea: HTMLTextAreaElement | null) => {
  if (!textarea) return;

  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
};

const createExpansionColumnState = (instruction: string): ExpansionColumnState => ({
  instruction,
  hasInitializedInstruction: instruction.length > 0,
  regenerateDialogOpen: false,
  regenerateInstructionDraft: "",
  pendingRegenerationConfirmation: null,
  expandedPanels: new Map(),
  addingIds: new Set(),
  deletedDerivationIds: new Set(),
  addError: null,
  generationErrorMessage: null,
});

const expansionColumnReducer = (
  state: ExpansionColumnState,
  action: ExpansionColumnAction,
): ExpansionColumnState => {
  switch (action.type) {
    case "reset":
      return createExpansionColumnState(action.instruction);
    case "initializeInstruction":
      if (state.hasInitializedInstruction || action.instruction.length === 0) {
        return state;
      }
      return {
        ...state,
        instruction: action.instruction,
        hasInitializedInstruction: true,
      };
    case "setInstruction":
      return {
        ...state,
        instruction: action.instruction,
        hasInitializedInstruction: true,
      };
    case "clearGenerationError":
      if (state.generationErrorMessage === null) return state;
      return {
        ...state,
        generationErrorMessage: null,
      };
    case "setGenerationError":
      return {
        ...state,
        generationErrorMessage: action.message,
      };
    case "openRegenerateDialog":
      return {
        ...state,
        generationErrorMessage: null,
        regenerateDialogOpen: true,
        regenerateInstructionDraft: action.instruction,
      };
    case "closeRegenerateDialog":
      return {
        ...state,
        regenerateDialogOpen: false,
        regenerateInstructionDraft: action.instruction,
      };
    case "setRegenerateInstructionDraft":
      return {
        ...state,
        regenerateInstructionDraft: action.instruction,
      };
    case "setPendingRegenerationConfirmation":
      return {
        ...state,
        pendingRegenerationConfirmation: action.confirmation,
      };
    case "togglePanel": {
      const next = new Map(state.expandedPanels);
      const existing = next.get(action.derivationId) ?? null;
      if (existing === action.panel) {
        next.delete(action.derivationId);
      } else {
        next.set(action.derivationId, action.panel);
      }
      return {
        ...state,
        expandedPanels: next,
      };
    }
    case "startAdding": {
      const next = new Set(state.addingIds);
      next.add(action.derivationId);
      return {
        ...state,
        addingIds: next,
      };
    }
    case "finishAdding": {
      const next = new Set(state.addingIds);
      next.delete(action.derivationId);
      return {
        ...state,
        addingIds: next,
      };
    }
    case "deleteDerivation": {
      const next = new Set(state.deletedDerivationIds);
      next.add(action.derivationId);
      return {
        ...state,
        deletedDerivationIds: next,
      };
    }
    case "setAddError":
      return {
        ...state,
        addError: action.message,
      };
  }
};

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
  const [state, dispatch] = useReducer(
    expansionColumnReducer,
    column.instruction ?? "",
    createExpansionColumnState,
  );
  const instructionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const allDerivations = query.data?.derivations ?? [];
  const derivations = allDerivations.filter((d) => !state.deletedDerivationIds.has(d.id));
  const isGenerating = isPending || inFlightForColumnCount > 0;
  const loading = isGenerating || query.isLoading;
  const resolvedInstruction = derivations[0]?.instruction ?? column.instruction ?? "";
  const errorMessage = state.generationErrorMessage ?? query.error?.message ?? null;

  useEffect(() => {
    dispatch({ type: "reset", instruction: column.instruction ?? "" });
  }, [column.id, column.instruction]);

  useEffect(() => {
    if (!state.hasInitializedInstruction && resolvedInstruction) {
      dispatch({ type: "initializeInstruction", instruction: resolvedInstruction });
    }
  }, [resolvedInstruction, state.hasInitializedInstruction]);

  useLayoutEffect(() => {
    autoResizeTextarea(instructionTextareaRef.current);
  }, [state.instruction]);

  const requestGeneration = useCallback(
    async ({
      instructionText,
      confirmed = false,
    }: RequestGenerationInput): Promise<RequestGenerationResult> => {
      dispatch({ type: "clearGenerationError" });
      try {
        const trimmedInstruction = instructionText.trim();
        const result = await generateDerivedCards({
          rootCardId: column.rootCardId,
          parent: column.parent,
          kind: "expansion",
          ...(trimmedInstruction ? { instruction: trimmedInstruction } : {}),
          ...(confirmed ? { confirmed: true } : {}),
        });

        if (isForgeDerivationConfirmationResult(result)) {
          return {
            status: "confirm_required",
            descendantCount: result.descendantCount,
          };
        }

        return { status: "completed" };
      } catch (error) {
        dispatch({ type: "setGenerationError", message: (error as Error).message });
        throw error;
      }
    },
    [column.parent, column.rootCardId, generateDerivedCards],
  );

  const handleRegenerateDialogOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        dispatch({ type: "openRegenerateDialog", instruction: resolvedInstruction });
        return;
      }
      dispatch({ type: "closeRegenerateDialog", instruction: resolvedInstruction });
    },
    [resolvedInstruction],
  );

  const handleRunGeneration = useCallback(
    async ({
      instructionText,
      closeRegenerateDialog,
      confirmed = false,
    }: {
      readonly instructionText: string;
      readonly closeRegenerateDialog?: boolean;
      readonly confirmed?: boolean;
    }) => {
      const result = await requestGeneration({ instructionText, confirmed });
      if (result.status === "confirm_required") {
        dispatch({
          type: "setPendingRegenerationConfirmation",
          confirmation: {
            instructionText,
            descendantCount: result.descendantCount,
          },
        });
        if (closeRegenerateDialog) {
          dispatch({ type: "closeRegenerateDialog", instruction: resolvedInstruction });
        }
        return;
      }

      if (closeRegenerateDialog) {
        dispatch({ type: "closeRegenerateDialog", instruction: resolvedInstruction });
      }
      dispatch({ type: "setPendingRegenerationConfirmation", confirmation: null });
      onRegenerated();
    },
    [onRegenerated, requestGeneration, resolvedInstruction],
  );

  const handleRegenerateClick = useCallback(() => {
    if (resolvedInstruction.trim()) {
      dispatch({ type: "openRegenerateDialog", instruction: resolvedInstruction });
      return;
    }

    void handleRunGeneration({ instructionText: resolvedInstruction }).catch(() => undefined);
  }, [handleRunGeneration, resolvedInstruction]);

  const handleRegenerateConfirm = useCallback(() => {
    void handleRunGeneration({
      instructionText: state.regenerateInstructionDraft,
      closeRegenerateDialog: true,
    }).catch(() => undefined);
  }, [handleRunGeneration, state.regenerateInstructionDraft]);

  const handleReplacementConfirm = useCallback(() => {
    if (!state.pendingRegenerationConfirmation) return;

    const { instructionText } = state.pendingRegenerationConfirmation;
    dispatch({ type: "setPendingRegenerationConfirmation", confirmation: null });
    void handleRunGeneration({
      instructionText,
      confirmed: true,
    }).catch(() => undefined);
  }, [handleRunGeneration, state.pendingRegenerationConfirmation]);

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
      if (!targetDeckPath || state.addingIds.has(derivationId)) return;

      dispatch({ type: "startAdding", derivationId });
      dispatch({ type: "setAddError", message: null });
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
          onError: (error) => dispatch({ type: "setAddError", message: error.message }),
          onSettled: () => dispatch({ type: "finishAdding", derivationId }),
        },
      );
    },
    [addCardToDeck, queryClient, queryKey, state.addingIds, targetDeckPath],
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
            {resolvedInstruction ? (
              <span className="mr-auto max-w-[400px] italic">"{resolvedInstruction}"</span>
            ) : null}
            {!isGenerating && derivations.length > 0 ? (
              <>
                {resolvedInstruction ? <span className="text-border">·</span> : null}
                <span>{derivations.length} cards</span>
                <span className="text-border">·</span>
                <button
                  type="button"
                  onClick={handleRegenerateClick}
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
              onClick={() =>
                void handleRunGeneration({ instructionText: state.instruction }).catch(
                  () => undefined,
                )
              }
            >
              Retry
            </Button>
          </div>
        ) : null}

        {!loading && derivations.length === 0 ? (
          <div className="mt-6">
            <textarea
              ref={instructionTextareaRef}
              value={state.instruction}
              onChange={(event) =>
                dispatch({ type: "setInstruction", instruction: event.target.value })
              }
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleRunGeneration({ instructionText: state.instruction }).catch(
                    () => undefined,
                  );
                }
              }}
              rows={1}
              className="w-full resize-none overflow-hidden bg-transparent text-sm text-foreground/80 outline-none placeholder:text-muted-foreground/40 whitespace-pre-wrap break-words"
              placeholder="What should these cards focus on?"
            />
            <button
              type="button"
              className="mt-5 flex items-center gap-1.5 text-[13px] text-muted-foreground/40 transition-colors hover:text-foreground/60"
              onClick={() =>
                void handleRunGeneration({ instructionText: state.instruction }).catch(
                  () => undefined,
                )
              }
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
                    className="h-4 animate-pulse rounded bg-muted/40"
                    style={{ width: `${90 - i * 7}%` }}
                  />
                  <div
                    className="h-4 animate-pulse rounded bg-muted/25"
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

        {state.addError ? (
          <p className="mt-4 text-[11px] text-destructive">{state.addError}</p>
        ) : null}

        {!isGenerating && derivations.length > 0 ? (
          <div>
            {derivations.map((derivation) => {
              const expandedPanel = state.expandedPanels.get(derivation.id) ?? null;
              const isExpanded = expandedDerivationIds.has(derivation.id);
              const hasExpanded = expandedPanel !== null || isExpanded;

              return (
                <div
                  key={derivation.id}
                  className={cn(
                    "group relative border-b border-border/20 py-4 last:border-b-0",
                    isExpanded && "bg-muted/35",
                  )}
                >
                  <div
                    className={cn("transition-opacity", derivation.addedCount > 0 && "opacity-40")}
                  >
                    <InlineEditor
                      content={derivation.question}
                      editable={derivation.addedCount === 0}
                      onContentChange={(value) =>
                        handleEditDerivation(derivation.id, "question", value)
                      }
                      className="min-h-0 text-[14px] font-medium leading-relaxed"
                    />
                    <InlineEditor
                      content={derivation.answer}
                      editable={derivation.addedCount === 0}
                      onContentChange={(value) =>
                        handleEditDerivation(derivation.id, "answer", value)
                      }
                      className="mt-1.5 min-h-0 text-sm leading-relaxed text-muted-foreground"
                    />
                  </div>

                  <div
                    className={cn(
                      "mt-3 flex items-center gap-1.5 transition-all",
                      hasExpanded
                        ? "opacity-100"
                        : "translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
                    )}
                  >
                    <AddToDeckButton
                      isAdded={derivation.addedCount > 0}
                      isAdding={state.addingIds.has(derivation.id)}
                      disabled={!targetDeckPath}
                      onClick={() =>
                        handleAddDerivation(derivation.id, derivation.question, derivation.answer)
                      }
                    />
                    <div className="mx-1 h-4 w-px bg-border/30" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className={cn(
                        "gap-1.5 text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
                        expandedPanel === "permutations" && "text-foreground",
                      )}
                      onClick={() =>
                        dispatch({
                          type: "togglePanel",
                          derivationId: derivation.id,
                          panel: "permutations",
                        })
                      }
                    >
                      <ListTree className="size-3" />
                      Permutations
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className={cn(
                        "gap-1.5 text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
                        expandedPanel === "cloze" && "text-foreground",
                      )}
                      onClick={() =>
                        dispatch({
                          type: "togglePanel",
                          derivationId: derivation.id,
                          panel: "cloze",
                        })
                      }
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
                          },
                          column.parent,
                        )
                      }
                    >
                      <ArrowRight className="size-3" />
                      {isExpanded ? "Expanded" : "Expand"}
                    </Button>

                    <div className="flex-1" />

                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      onClick={() =>
                        dispatch({ type: "deleteDerivation", derivationId: derivation.id })
                      }
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>

                  {expandedPanel === "permutations" ? (
                    <div className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
                      <PermutationsPanel
                        parent={{ derivationId: derivation.id }}
                        rootCardId={column.rootCardId}
                      />
                    </div>
                  ) : null}

                  {expandedPanel === "cloze" ? (
                    <div className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
                      <ClozePanel
                        source={{ derivationId: derivation.id }}
                        sourceQuestion={derivation.question}
                        sourceAnswer={derivation.answer}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <ExpansionRegenerateDialogs
        editOpen={state.regenerateDialogOpen}
        editInstruction={state.regenerateInstructionDraft}
        pendingConfirmation={state.pendingRegenerationConfirmation}
        errorMessage={errorMessage}
        isGenerating={isGenerating}
        onEditOpenChange={handleRegenerateDialogOpenChange}
        onEditInstructionChange={(instruction) =>
          dispatch({ type: "setRegenerateInstructionDraft", instruction })
        }
        onEditConfirm={handleRegenerateConfirm}
        onConfirmationOpenChange={(open) => {
          if (!open) {
            dispatch({ type: "setPendingRegenerationConfirmation", confirmation: null });
          }
        }}
        onConfirmationConfirm={handleReplacementConfirm}
      />
    </section>
  );
}
