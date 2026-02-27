import { Button } from "@/components/ui/button";

import type { ForgeCard, TopicCardGeneration } from "./mock-cards-data";
import { CardBlock } from "./card-block";
import { TopicHeaderCard } from "./topic-header-card";

type CardsCanvasProps = {
  readonly topicText: string | null;
  readonly generation: TopicCardGeneration | null;
  readonly addedCardIds: ReadonlySet<string>;
  readonly deletedCardIds: ReadonlySet<string>;
  readonly onAddCard: (cardId: string) => void;
  readonly onDeleteCard: (cardId: string) => void;
  readonly onEditCard: (cardId: string, field: "question" | "answer", value: string) => void;
  readonly onAddPermutation: (cardId: string) => void;
  readonly onAddCloze: (cardId: string) => void;
  readonly onRegenerate: () => void;
  readonly onGenerateCards: () => void;
};

function visibleCards(
  cards: ReadonlyArray<ForgeCard>,
  deletedCardIds: ReadonlySet<string>,
): ForgeCard[] {
  return cards.filter((c) => !deletedCardIds.has(c.id));
}

export function CardsCanvas({
  topicText,
  generation,
  addedCardIds,
  deletedCardIds,
  onAddCard,
  onDeleteCard,
  onEditCard,
  onAddPermutation,
  onAddCloze,
  onRegenerate,
  onGenerateCards,
}: CardsCanvasProps) {
  if (!topicText || !generation) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-xs text-muted-foreground/40">Select a topic from the sidebar</p>
      </div>
    );
  }

  const cards = visibleCards(generation.cards, deletedCardIds);
  const addedCount = cards.filter((c) => addedCardIds.has(c.id)).length;
  const hasUnadded = cards.some((c) => !addedCardIds.has(c.id));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[700px] px-12 py-7 pb-20">
        {generation.status === "generating" && (
          <div className="flex items-center gap-2.5 py-12 text-muted-foreground/50">
            <span className="inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
            <span className="text-[13px]">Generating cards…</span>
          </div>
        )}

        {generation.status === "idle" && (
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

        {generation.status === "error" && (
          <div className="py-12">
            <p className="text-[13px] text-destructive">
              {generation.errorMessage ?? "Generation failed"}
            </p>
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

        {generation.status === "generated" && (
          <>
            <TopicHeaderCard
              topicText={topicText}
              cardCount={cards.length}
              addedCount={addedCount}
              hasUnadded={hasUnadded}
              onRegenerate={onRegenerate}
            />

            <div className="mt-4">
              {cards.map((card) => (
                <CardBlock
                  key={card.id}
                  card={card}
                  isAdded={addedCardIds.has(card.id)}
                  onAdd={() => onAddCard(card.id)}
                  onDelete={() => onDeleteCard(card.id)}
                  onEditQuestion={(v) => onEditCard(card.id, "question", v)}
                  onEditAnswer={(v) => onEditCard(card.id, "answer", v)}
                  onAddPermutation={() => onAddPermutation(card.id)}
                  onAddCloze={() => onAddCloze(card.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
