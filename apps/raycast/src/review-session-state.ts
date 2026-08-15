import type { ReviewCardReference, ReviewSession } from "./review-store";

export interface RemovedReviewQueueEntry {
  readonly index: number;
  readonly card: ReviewCardReference;
}

export interface ReviewSessionItemRemoval {
  readonly session: ReviewSession;
  readonly removedEntries: readonly RemovedReviewQueueEntry[];
  readonly nextIndex: number | null;
}

export const removeSourceItemFromSession = (
  session: ReviewSession,
  currentIndex: number,
  source: {
    readonly deckPath: string;
    readonly sourceCardIds: readonly string[];
  },
): ReviewSessionItemRemoval => {
  const sourceCardIds = new Set(source.sourceCardIds);
  const remainingCards: ReviewCardReference[] = [];
  const removedEntries: RemovedReviewQueueEntry[] = [];
  let nextIndex: number | null = null;

  for (const [index, card] of session.cards.entries()) {
    if (card.deckPath === source.deckPath && sourceCardIds.has(card.cardId)) {
      removedEntries.push({ index, card });
      continue;
    }

    if (nextIndex === null && index > currentIndex) {
      nextIndex = remainingCards.length;
    }
    remainingCards.push(card);
  }

  return {
    session: { ...session, cards: remainingCards },
    removedEntries,
    nextIndex,
  };
};

export const restoreSourceItemToSession = (
  session: ReviewSession,
  removedEntries: readonly RemovedReviewQueueEntry[],
): ReviewSession => {
  const cards = [...session.cards];
  const entries = [...removedEntries].sort((left, right) => left.index - right.index);

  for (const { index, card } of entries) {
    cards.splice(index, 0, card);
  }

  return { ...session, cards };
};
