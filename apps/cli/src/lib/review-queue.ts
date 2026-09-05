import { Effect } from "effect";
import { annotateBuiltinCardKeys } from "@re/item-types";
import {
  DeckParseError,
  type QueueItem,
  type ReviewQueue as WorkspaceReviewQueue,
} from "@re/workspace";

export interface ReviewQueueItem extends QueueItem {
  readonly cardKey: string;
}

export interface ReviewQueue extends WorkspaceReviewQueue {
  readonly items: readonly ReviewQueueItem[];
}

export const prepareReviewQueue = (queue: WorkspaceReviewQueue): Effect.Effect<ReviewQueue> =>
  annotateBuiltinCardKeys(queue.items).pipe(
    Effect.map(({ items, errors }) => ({
      ...queue,
      items,
      totalNew: items.filter((item) => item.category === "new").length,
      totalDue: items.filter((item) => item.category === "due").length,
      deckErrors: [
        ...queue.deckErrors,
        ...errors.map(
          ({ entry, error }) =>
            new DeckParseError({
              deckPath: entry.deckPath,
              message: `Card ${entry.card.id}: ${error.message}`,
            }),
        ),
      ],
    })),
  );
