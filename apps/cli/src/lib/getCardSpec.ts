import { Effect } from "effect";
import type { EvaluableCardSpec, ItemMetadata } from "@re/core";
import { resolveBuiltinCard } from "@re/item-types";
import { DeckManager } from "@re/workspace";
import type { ReviewQueueItem } from "./review-queue";

export class CardSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardSpecError";
  }
}

export const loadReviewCard = (
  queueItem: ReviewQueueItem,
): Effect.Effect<
  { readonly card: ItemMetadata; readonly spec: EvaluableCardSpec },
  CardSpecError,
  DeckManager
> =>
  Effect.gen(function* () {
    const decks = yield* DeckManager;
    const file = yield* decks.readDeck(queueItem.deckPath);
    const item = file.items.find((item) =>
      item.cards.some((card) => card.id === queueItem.card.id),
    );
    if (!item) {
      return yield* Effect.fail(new CardSpecError(`Card not found: ${queueItem.card.id}`));
    }
    return yield* resolveBuiltinCard(item, {
      cardId: queueItem.card.id,
      cardKey: queueItem.cardKey,
    });
  }).pipe(
    Effect.mapError(
      (error) => new CardSpecError(error.message || `Could not load card ${queueItem.card.id}.`),
    ),
  );

export const getCardSpec = (
  queueItem: ReviewQueueItem,
): Effect.Effect<EvaluableCardSpec, CardSpecError, DeckManager> =>
  loadReviewCard(queueItem).pipe(Effect.map(({ spec }) => spec));
