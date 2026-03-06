import type { LightQueueItem, ReviewCardRef } from "@shared/rpc/schemas/review";

export type ReviewAssistantCardRef = Pick<LightQueueItem, "deckPath" | "cardId" | "cardIndex">;

export const toReviewAssistantCardRef = (
  queueItem: LightQueueItem | null | undefined,
): ReviewAssistantCardRef | null =>
  queueItem
    ? {
        deckPath: queueItem.deckPath,
        cardId: queueItem.cardId,
        cardIndex: queueItem.cardIndex,
      }
    : null;

export const toReviewAssistantCardKey = (card: ReviewCardRef | null | undefined): string | null =>
  card ? `${card.deckPath}\u0000${card.cardId}\u0000${card.cardIndex}` : null;
