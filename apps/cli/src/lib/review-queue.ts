import { Effect } from "effect";
import { annotateBuiltinCardKeys } from "@re/item-types";
import type { QueueItem, ReviewQueue as WorkspaceReviewQueue } from "@re/workspace";

export interface ReviewQueueItem extends QueueItem {
  readonly cardKey: string | null;
}

export interface ReviewQueue extends WorkspaceReviewQueue {
  readonly items: readonly ReviewQueueItem[];
}

export const prepareReviewQueue = (queue: WorkspaceReviewQueue): Effect.Effect<ReviewQueue> =>
  annotateBuiltinCardKeys(queue.items).pipe(Effect.map((items) => ({ ...queue, items })));
