import { Context, Effect, Layer, Array as Arr, Order, Random, Chunk } from "effect";
import { Path } from "@effect/platform";
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
  readonly relativePath: string;
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

export type WithinGroupOrder<A> = (items: readonly A[]) => Effect.Effect<readonly A[]>;

export const preserveOrder =
  <A>(): WithinGroupOrder<A> =>
  (items) =>
    Effect.succeed(items);

export const sortBy =
  <A>(order: Order.Order<A>): WithinGroupOrder<A> =>
  (items) =>
    Effect.succeed(Arr.sort(items, order));

export const shuffle =
  <A>(): WithinGroupOrder<A> =>
  (items) =>
    Effect.map(Random.shuffle(items), Chunk.toReadonlyArray);

export const chain =
  <A>(...orders: WithinGroupOrder<A>[]): WithinGroupOrder<A> =>
  (items) =>
    orders.reduce(
      (acc, order) => Effect.flatMap(acc, order),
      Effect.succeed(items) as Effect.Effect<readonly A[]>,
    );

export const byDueDate: Order.Order<QueueItem> = Order.make((a, b) => {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return Order.number(a.dueDate.getTime(), b.dueDate.getTime());
});

export const byFilePosition: Order.Order<QueueItem> = Order.combine(
  Order.mapInput(Order.string, (q: QueueItem) => q.deckPath),
  Order.mapInput(Order.number, (q: QueueItem) => q.itemIndex),
);

export interface QueueOrderSpec {
  readonly primaryOrder: "new-first" | "due-first";
  readonly newCardOrder: WithinGroupOrder<QueueItem>;
  readonly dueCardOrder: WithinGroupOrder<QueueItem>;
}

export const QueueOrderSpec = Context.GenericTag<QueueOrderSpec>("QueueOrderSpec");

export interface QueueOrderingStrategy {
  readonly order: (items: readonly QueueItem[]) => Effect.Effect<readonly QueueItem[]>;
}

export const QueueOrderingStrategy =
  Context.GenericTag<QueueOrderingStrategy>("QueueOrderingStrategy");

export const QueueOrderingStrategyFromSpec = Layer.effect(
  QueueOrderingStrategy,
  Effect.gen(function* () {
    const spec = yield* QueueOrderSpec;

    return {
      order: (items) =>
        Effect.gen(function* () {
          const [dueItems, newItems] = Arr.partition(items, (i) => i.category === "new");

          const orderedNew = yield* spec.newCardOrder(newItems);
          const orderedDue = yield* spec.dueCardOrder(dueItems);

          return spec.primaryOrder === "new-first"
            ? [...orderedNew, ...orderedDue]
            : [...orderedDue, ...orderedNew];
        }),
    };
  }),
);

export const NewFirstByDueDateSpec = Layer.succeed(QueueOrderSpec, {
  primaryOrder: "new-first",
  newCardOrder: preserveOrder<QueueItem>(),
  dueCardOrder: sortBy(byDueDate),
});

export const DueFirstByDueDateSpec = Layer.succeed(QueueOrderSpec, {
  primaryOrder: "due-first",
  newCardOrder: preserveOrder<QueueItem>(),
  dueCardOrder: sortBy(byDueDate),
});

export const NewFirstShuffledSpec = Layer.succeed(QueueOrderSpec, {
  primaryOrder: "new-first",
  newCardOrder: shuffle<QueueItem>(),
  dueCardOrder: sortBy(byDueDate),
});

export const NewFirstFileOrderSpec = Layer.succeed(QueueOrderSpec, {
  primaryOrder: "new-first",
  newCardOrder: sortBy(byFilePosition),
  dueCardOrder: sortBy(byDueDate),
});

export const NewFirstOrderingStrategy = QueueOrderingStrategyFromSpec.pipe(
  Layer.provide(NewFirstByDueDateSpec),
);

export const DueFirstOrderingStrategy = QueueOrderingStrategyFromSpec.pipe(
  Layer.provide(DueFirstByDueDateSpec),
);

export const ShuffledOrderingStrategy = Layer.succeed(QueueOrderingStrategy, {
  order: shuffle<QueueItem>(),
});

export interface ReviewQueueService {
  readonly buildQueue: (
    selection: Selection,
    tree: readonly DeckTreeNode[],
    rootPath: string,
    now: Date,
  ) => Effect.Effect<ReviewQueue>;
}

export const ReviewQueueService = Context.GenericTag<ReviewQueueService>("ReviewQueueService");

const collectDeckPaths = (selection: Selection, tree: readonly DeckTreeNode[]): string[] => {
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

  const findAndCollect = (nodes: readonly DeckTreeNode[], targetPath: string): boolean => {
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
    const pathService = yield* Path.Path;

    return {
      buildQueue: (selection, tree, rootPath, now) =>
        Effect.gen(function* () {
          const deckPaths = collectDeckPaths(selection, tree);

          const parsedDecks = yield* deckParser.parseAll(deckPaths);

          const allItems: QueueItem[] = [];

          for (const { path: deckPath, name: deckName, file } of parsedDecks) {
            const relativePath = pathService.relative(rootPath, deckPath);
            for (let itemIndex = 0; itemIndex < file.items.length; itemIndex++) {
              const item = file.items[itemIndex]!;
              for (let cardIndex = 0; cardIndex < item.cards.length; cardIndex++) {
                const card = item.cards[cardIndex]!;
                const isNew = card.state === State.New;
                const isDue = !isNew && scheduler.isDue(card, now);

                // Only include new or due cards
                if (isNew || isDue) {
                  allItems.push({
                    deckPath,
                    deckName,
                    relativePath,
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
  }),
);

// Convenience layer with default (shuffled) ordering
export const ReviewQueueLive = ReviewQueueServiceLive.pipe(Layer.provide(ShuffledOrderingStrategy));
