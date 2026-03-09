import { Button } from "@/components/ui/button";
import type {
  DerivationParentRef,
  ForgeGeneratedCard,
  ForgeTopicCardsStatus,
} from "@shared/rpc/schemas/forge";
import type { ExpansionColumnDescriptor } from "../forge-page-store";

import { CardBlock } from "./card-block";
import { ExpansionColumnStack } from "./expansion-column-stack";
import { TopicHeaderCard } from "./topic-header-card";

type RootCardExpansionPresentation = {
  readonly status: "idle" | "expanding" | "expanded";
  readonly summary?: {
    readonly cardCount: number;
    readonly instruction?: string;
  };
};

type CardsCanvasProps = {
  readonly topicKey: string | null;
  readonly topicText: string | null;
  readonly status: ForgeTopicCardsStatus | null;
  readonly errorMessage: string | null;
  readonly cards: ReadonlyArray<ForgeGeneratedCard>;
  readonly addedCardIds: ReadonlySet<number>;
  readonly addingCardIds: ReadonlySet<number>;
  readonly addDisabled: boolean;
  readonly addCardError: string | null;
  readonly deletedCardIds: ReadonlySet<number>;
  readonly expandedPanels: ReadonlyMap<number, "permutations" | "cloze">;
  readonly reformulatingCardIds: ReadonlySet<number>;
  readonly reformulateErrorsByCardId: ReadonlyMap<number, string>;
  readonly expansionPresentationByCardId: ReadonlyMap<number, RootCardExpansionPresentation>;
  readonly expansionColumns: ReadonlyArray<ExpansionColumnDescriptor>;
  readonly expandedDerivationIds: ReadonlySet<number>;
  readonly onAddCard: (cardId: number) => void;
  readonly onDeleteCard: (cardId: number) => void;
  readonly onReformulateCard: (card: ForgeGeneratedCard) => void;
  readonly onTogglePanel: (cardId: number, panel: "permutations" | "cloze") => void;
  readonly onEditCard: (cardId: number, field: "question" | "answer", value: string) => void;
  readonly onRegenerate: () => void;
  readonly onGenerateCards: () => void;
  readonly onRequestExpansionFromRoot: (card: ForgeGeneratedCard) => void;
  readonly onRequestExpansionFromColumn: (
    descriptor: ExpansionColumnDescriptor,
    sourceColumnParent: DerivationParentRef,
  ) => void;
  readonly onCloseExpansionColumn: (columnId: string) => void;
  readonly onRegeneratedExpansionColumn: (columnId: string) => void;
};

function visibleCards(
  cards: ReadonlyArray<ForgeGeneratedCard>,
  deletedCardIds: ReadonlySet<number>,
): ForgeGeneratedCard[] {
  return cards.filter((card) => !deletedCardIds.has(card.id));
}

export function CardsCanvas({
  topicKey,
  topicText,
  status,
  errorMessage,
  cards,
  addedCardIds,
  addingCardIds,
  addDisabled,
  addCardError,
  deletedCardIds,
  expandedPanels,
  reformulatingCardIds,
  reformulateErrorsByCardId,
  expansionPresentationByCardId,
  expansionColumns,
  expandedDerivationIds,
  onAddCard,
  onDeleteCard,
  onReformulateCard,
  onTogglePanel,
  onEditCard,
  onRegenerate,
  onGenerateCards,
  onRequestExpansionFromRoot,
  onRequestExpansionFromColumn,
  onCloseExpansionColumn,
  onRegeneratedExpansionColumn,
}: CardsCanvasProps) {
  const visible = status ? visibleCards(cards, deletedCardIds) : [];
  const addedCount = visible.filter((card) => addedCardIds.has(card.id)).length;
  const hasUnadded = visible.some((card) => !addedCardIds.has(card.id));

  if (!topicText || !status) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground/40">Select a topic from the sidebar</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-x-auto">
      <div className="min-h-0 w-[760px] only:w-[900px] shrink-0 overflow-y-auto mx-auto">
        <div className="px-12 py-7 pb-20">
          <TopicHeaderCard
            topicText={topicText}
            cardCount={visible.length}
            addedCount={addedCount}
            hasUnadded={hasUnadded}
            onRegenerate={onRegenerate}
          />

          {status === "generating" && (
            <div className="flex items-center gap-2.5 py-12 text-muted-foreground/50">
              <span className="inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
              <span className="text-[13px]">Generating cards...</span>
            </div>
          )}

          {status === "idle" && (
            <div className="py-12">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={onGenerateCards}
              >
                Generate cards
              </Button>
            </div>
          )}

          {status === "error" && (
            <div className="py-12">
              <p className="text-[13px] text-destructive">{errorMessage ?? "Generation failed"}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={onGenerateCards}
              >
                Retry
              </Button>
            </div>
          )}

          {status === "generated" && (
            <div className="mt-4">
              {addCardError && <p className="mb-3 text-[11px] text-destructive">{addCardError}</p>}
              {visible.map((card) => {
                const expansionPresentation = expansionPresentationByCardId.get(card.id);
                return (
                  <CardBlock
                    key={card.id}
                    card={card}
                    isAdded={addedCardIds.has(card.id)}
                    isAdding={addingCardIds.has(card.id)}
                    addDisabled={addDisabled}
                    expandedPanel={expandedPanels.get(card.id) ?? null}
                    expansionStatus={expansionPresentation?.status ?? "idle"}
                    isReformulating={reformulatingCardIds.has(card.id)}
                    reformulateErrorMessage={reformulateErrorsByCardId.get(card.id) ?? null}
                    onAdd={() => onAddCard(card.id)}
                    onDelete={() => onDeleteCard(card.id)}
                    onReformulate={() => onReformulateCard(card)}
                    onTogglePermutations={() => onTogglePanel(card.id, "permutations")}
                    onToggleCloze={() => onTogglePanel(card.id, "cloze")}
                    onRequestExpansion={() => onRequestExpansionFromRoot(card)}
                    onEditQuestion={(value) => onEditCard(card.id, "question", value)}
                    onEditAnswer={(value) => onEditCard(card.id, "answer", value)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {topicKey ? (
        <ExpansionColumnStack
          topicKey={topicKey}
          columns={expansionColumns}
          expandedDerivationIds={expandedDerivationIds}
          onCloseColumn={onCloseExpansionColumn}
          onRegeneratedColumn={onRegeneratedExpansionColumn}
          onRequestExpansion={onRequestExpansionFromColumn}
        />
      ) : null}
    </div>
  );
}
