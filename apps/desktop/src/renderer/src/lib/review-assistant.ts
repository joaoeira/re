import type { LightQueueItem, ReviewCardRef } from "@shared/rpc/schemas/review";

export type ReviewAssistantCardRef = Pick<LightQueueItem, "deckPath" | "cardId" | "cardKey">;

export const toReviewAssistantCardRef = (
  queueItem: LightQueueItem | null | undefined,
): ReviewAssistantCardRef | null =>
  queueItem
    ? {
        deckPath: queueItem.deckPath,
        cardId: queueItem.cardId,
        cardKey: queueItem.cardKey,
      }
    : null;

export const toReviewAssistantCardKey = (card: ReviewCardRef | null | undefined): string | null =>
  card ? `${card.deckPath}\u0000${card.cardId}\u0000${card.cardKey}` : null;
