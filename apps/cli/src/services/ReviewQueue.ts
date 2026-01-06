import { Context, Effect, Layer, Array as Arr, pipe, Order } from "effect";
import { type Item, type ItemMetadata, State } from "@re/core";
import { Scheduler } from "./Scheduler";
import { DeckParser } from "./DeckParser";
import type { DeckTreeNode } from "../lib/buildDeckTree";

export type Selection =
  | { readonly type: "all" }
  | { readonly type: "folder"; readonly path: string }
  | { readonly type: "deck"; readonly path: string };

export interface QueueItem {
  readonly deckPath: string;
  readonly deckName: string;
  readonly item: Item;
  readonly card: ItemMetadata;
  readonly cardIndex: number; // index within item.cards (for multi-card items)
  readonly itemIndex: number; // index within ParsedFile.items (for stable updates)
  readonly category: "new" | "due";
  readonly dueDate: Date | null;
}

export interface ReviewQueue {
  readonly items: readonly QueueItem[];
  readonly totalNew: number;
  readonly totalDue: number;
}

export interface QueueOrderingStrategy {
  readonly order: (
    items: readonly QueueItem[]
  ) => Effect.Effect<readonly QueueItem[]>;
}

export const QueueOrderingStrategy = Context.GenericTag<QueueOrderingStrategy>(
  "QueueOrderingStrategy"
);

const byDueDate: Order.Order<QueueItem> = Order.make((a, b) => {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return Order.number(a.dueDate.getTime(), b.dueDate.getTime());
});

export const NewFirstOrderingStrategy = Layer.succeed(QueueOrderingStrategy, {
  order: (items) =>
    Effect.succeed(
      pipe(
        items,
        Arr.partition((item) => item.category === "new"),
        ([due, newItems]) => [...newItems, ...pipe(due, Arr.sort(byDueDate))]
      )
    ),
});

export const DueFirstOrderingStrategy = Layer.succeed(QueueOrderingStrategy, {
  order: (items) =>
    Effect.succeed(
      pipe(
        items,
        Arr.partition((item) => item.category === "due"),
        ([newItems, dueItems]) => [
          ...pipe(dueItems, Arr.sort(byDueDate)),
          ...newItems,
        ]
      )
    ),
});

export interface ReviewQueueService {
  readonly buildQueue: (
    selection: Selection,
    tree: readonly DeckTreeNode[],
    rootPath: string,
    now: Date
  ) => Effect.Effect<ReviewQueue>;
}

export const ReviewQueueService =
  Context.GenericTag<ReviewQueueService>("ReviewQueueService");

const collectDeckPaths = (
  selection: Selection,
  tree: readonly DeckTreeNode[]
): string[] => {
  const paths: string[] = [];

  const collectFromNode = (node: DeckTreeNode): void => {
    if (node.type === "deck") {
      paths.push(node.stats.path);
    } else {
      for (const child of node.children) {
        collectFromNode(child);
      }
    }
  };

  const findAndCollect = (
    nodes: readonly DeckTreeNode[],
    targetPath: string
  ): boolean => {
    for (const node of nodes) {
      if (node.type === "folder" && node.path === targetPath) {
        collectFromNode(node);
        return true;
      }
      if (node.type === "deck" && node.stats.path === targetPath) {
        paths.push(node.stats.path);
        return true;
      }
      if (node.type === "folder") {
        if (findAndCollect(node.children, targetPath)) return true;
      }
    }
    return false;
  };

  switch (selection.type) {
    case "all":
      for (const node of tree) {
        collectFromNode(node);
      }
      break;
    case "folder":
      findAndCollect(tree, selection.path);
      break;
    case "deck":
      findAndCollect(tree, selection.path);
      break;
  }

  return paths;
};

export const ReviewQueueServiceLive = Layer.effect(
  ReviewQueueService,
  Effect.gen(function* () {
    const deckParser = yield* DeckParser;
    const scheduler = yield* Scheduler;
    const orderingStrategy = yield* QueueOrderingStrategy;

    return {
      buildQueue: (selection, tree, _rootPath, now) =>
        Effect.gen(function* () {
          const deckPaths = collectDeckPaths(selection, tree);

          const parsedDecks = yield* deckParser.parseAll(deckPaths);

          const allItems: QueueItem[] = [];

          for (const { path: deckPath, name: deckName, file } of parsedDecks) {
            for (
              let itemIndex = 0;
              itemIndex < file.items.length;
              itemIndex++
            ) {
              const item = file.items[itemIndex]!;
              for (
                let cardIndex = 0;
                cardIndex < item.cards.length;
                cardIndex++
              ) {
                const card = item.cards[cardIndex]!;
                const isNew = card.state === State.New;
                const isDue = !isNew && scheduler.isDue(card, now);

                // Only include new or due cards
                if (isNew || isDue) {
                  allItems.push({
                    deckPath,
                    deckName,
                    item,
                    card,
                    cardIndex,
                    itemIndex,
                    category: isNew ? "new" : "due",
                    dueDate: scheduler.getReviewDate(card),
                  });
                }
              }
            }
          }

          const orderedItems = yield* orderingStrategy.order(allItems);

          return {
            items: orderedItems,
            totalNew: orderedItems.filter((i) => i.category === "new").length,
            totalDue: orderedItems.filter((i) => i.category === "due").length,
          };
        }),
    };
  })
);

// Convenience layer with default (new first) ordering
export const ReviewQueueLive = ReviewQueueServiceLive.pipe(
  Layer.provide(NewFirstOrderingStrategy)
);
