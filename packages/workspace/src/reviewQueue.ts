import { Path } from "@effect/platform";
import { type Item, type ItemMetadata, State } from "@re/core";
import { Array as Arr, Chunk, Context, Effect, Layer, Order, Random } from "effect";

import { DeckManager } from "./DeckManager";
import type { DeckTreeNode } from "./deckTree";
import { resolveDueDateIfDue } from "./scheduler";

export interface QueueItem {
  readonly deckPath: string;
  readonly deckName: string;
  readonly relativePath: string;
  readonly item: Item;
  readonly card: ItemMetadata;
  readonly cardIndex: number;
  readonly filePosition: number;
  readonly category: "new" | "due";
  readonly dueDate: Date | null;
}

export interface ReviewQueue {
  readonly items: readonly QueueItem[];
  readonly totalNew: number;
  readonly totalDue: number;
}

export type ReviewQueueOrder = "default" | "due-first" | "new-first";

export interface ReviewQueueOptions {
  readonly includeNew: boolean;
  readonly includeDue: boolean;
  readonly cardLimit: number | null;
  readonly order: ReviewQueueOrder;
}

export const DEFAULT_REVIEW_QUEUE_OPTIONS: ReviewQueueOptions = {
  includeNew: true,
  includeDue: true,
  cardLimit: null,
  order: "default",
};

export type ReviewQueueSelection =
  | { readonly type: "all" }
  | { readonly type: "folder"; readonly path: string }
  | { readonly type: "deck"; readonly path: string };

export const collectDeckPathsFromSelection = (
  selection: ReviewQueueSelection,
  tree: readonly DeckTreeNode[],
): string[] => {
  const paths: string[] = [];

  const collectFromNode = (node: DeckTreeNode): void => {
    if (node.kind === "leaf") {
      paths.push(node.snapshot.absolutePath);
    } else {
      for (const child of node.children) {
        collectFromNode(child);
      }
    }
  };

  const findAndCollect = (nodes: readonly DeckTreeNode[], targetPath: string): boolean => {
    for (const node of nodes) {
      if (node.kind === "group" && node.relativePath === targetPath) {
        collectFromNode(node);
        return true;
      }
      if (node.kind === "leaf" && node.relativePath === targetPath) {
        paths.push(node.snapshot.absolutePath);
        return true;
      }
      if (node.kind === "group" && findAndCollect(node.children, targetPath)) {
        return true;
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
  Order.mapInput(Order.number, (q: QueueItem) => q.filePosition),
);

export interface QueueOrderSpec {
  readonly primaryOrder: "new-first" | "due-first";
  readonly newCardOrder: WithinGroupOrder<QueueItem>;
  readonly dueCardOrder: WithinGroupOrder<QueueItem>;
}

export const QueueOrderSpec = Context.GenericTag<QueueOrderSpec>("@re/workspace/QueueOrderSpec");

export interface QueueOrderingStrategy {
  readonly order: (items: readonly QueueItem[]) => Effect.Effect<readonly QueueItem[]>;
}

export const QueueOrderingStrategy = Context.GenericTag<QueueOrderingStrategy>(
  "@re/workspace/QueueOrderingStrategy",
);

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

const normalizeReviewQueueOptions = (options: ReviewQueueOptions | undefined): ReviewQueueOptions =>
  options ?? DEFAULT_REVIEW_QUEUE_OPTIONS;

const applyCategoryFilters = (
  items: readonly QueueItem[],
  options: ReviewQueueOptions,
): readonly QueueItem[] =>
  items.filter((item) => (item.category === "new" ? options.includeNew : options.includeDue));

const applyCardLimit = (
  items: readonly QueueItem[],
  options: ReviewQueueOptions,
): readonly QueueItem[] => (options.cardLimit === null ? items : items.slice(0, options.cardLimit));

const countCategory = (items: readonly QueueItem[], category: QueueItem["category"]): number =>
  items.filter((item) => item.category === category).length;

const orderNewFirst = (items: readonly QueueItem[]): Effect.Effect<readonly QueueItem[]> =>
  Effect.gen(function* () {
    const [dueItems, newItems] = Arr.partition(items, (i) => i.category === "new");
    const orderedDue = yield* sortBy(byDueDate)(dueItems);
    return [...newItems, ...orderedDue];
  });

const orderDueFirst = (items: readonly QueueItem[]): Effect.Effect<readonly QueueItem[]> =>
  Effect.gen(function* () {
    const [dueItems, newItems] = Arr.partition(items, (i) => i.category === "new");
    const orderedDue = yield* sortBy(byDueDate)(dueItems);
    return [...orderedDue, ...newItems];
  });

export interface ReviewQueueBuilder {
  /**
   * Contract for `deckPaths`:
   * - absolute paths are expected
   * - caller order is preserved (no deduplication)
   */
  readonly buildQueue: (input: {
    readonly deckPaths: readonly string[];
    readonly rootPath: string;
    readonly now: Date;
    readonly options?: ReviewQueueOptions;
  }) => Effect.Effect<ReviewQueue>;
}

export const ReviewQueueBuilder = Context.GenericTag<ReviewQueueBuilder>(
  "@re/workspace/ReviewQueueBuilder",
);

export const ReviewQueueBuilderLive = Layer.effect(
  ReviewQueueBuilder,
  Effect.gen(function* () {
    const deckManager = yield* DeckManager;
    const orderingStrategy = yield* QueueOrderingStrategy;
    const pathService = yield* Path.Path;

    return {
      buildQueue: ({ deckPaths, rootPath, now, options: rawOptions }) =>
        Effect.gen(function* () {
          const options = normalizeReviewQueueOptions(rawOptions);
          const results = yield* Effect.all(
            deckPaths.map((p) => deckManager.readDeck(p).pipe(Effect.either)),
            { concurrency: "unbounded" },
          );

          const allItems: QueueItem[] = [];

          let filePosition = 0;
          for (let i = 0; i < deckPaths.length; i++) {
            const result = results[i]!;
            if (result._tag === "Left") continue;

            const deckPath = deckPaths[i]!;
            const file = result.right;
            const deckName = pathService.basename(deckPath, ".md");
            const relativePath = pathService.relative(rootPath, deckPath);

            for (const item of file.items) {
              for (let cardIndex = 0; cardIndex < item.cards.length; cardIndex++) {
                const card = item.cards[cardIndex]!;
                if (card.state === State.New) {
                  allItems.push({
                    deckPath,
                    deckName,
                    relativePath,
                    item,
                    card,
                    cardIndex,
                    filePosition,
                    category: "new",
                    dueDate: null,
                  });
                } else {
                  const dueDate = resolveDueDateIfDue(card, now);
                  if (dueDate !== null) {
                    allItems.push({
                      deckPath,
                      deckName,
                      relativePath,
                      item,
                      card,
                      cardIndex,
                      filePosition,
                      category: "due",
                      dueDate,
                    });
                  }
                }
                filePosition++;
              }
            }
          }

          const filteredItems = applyCategoryFilters(allItems, options);
          const orderedItems = yield* (() => {
            switch (options.order) {
              case "default":
                return orderingStrategy.order(filteredItems);
              case "due-first":
                return orderDueFirst(filteredItems);
              case "new-first":
                return orderNewFirst(filteredItems);
            }
          })();
          const limitedItems = applyCardLimit(orderedItems, options);

          return {
            items: limitedItems,
            totalNew: countCategory(limitedItems, "new"),
            totalDue: countCategory(limitedItems, "due"),
          };
        }),
    };
  }),
);

export interface ReviewQueueService {
  readonly buildQueue: (
    selection: ReviewQueueSelection,
    tree: readonly DeckTreeNode[],
    rootPath: string,
    now: Date,
  ) => Effect.Effect<ReviewQueue>;
}

export const ReviewQueueService = Context.GenericTag<ReviewQueueService>(
  "@re/workspace/ReviewQueueService",
);

export const ReviewQueueServiceLive = Layer.effect(
  ReviewQueueService,
  Effect.gen(function* () {
    const queueBuilder = yield* ReviewQueueBuilder;

    return {
      buildQueue: (selection, tree, rootPath, now) =>
        queueBuilder.buildQueue({
          deckPaths: collectDeckPathsFromSelection(selection, tree),
          rootPath,
          now,
        }),
    };
  }),
).pipe(Layer.provide(ReviewQueueBuilderLive));

export const ReviewQueueLive = ReviewQueueServiceLive.pipe(Layer.provide(ShuffledOrderingStrategy));
