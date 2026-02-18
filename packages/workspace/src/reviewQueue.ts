import { Path } from "@effect/platform";
import { type Item, type ItemMetadata, State } from "@re/core";
import { Array as Arr, Chunk, Context, Effect, Layer, Option, Order, Random } from "effect";

import { DeckManager } from "./DeckManager";

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

export interface ReviewDuePolicy {
  readonly dueDateIfDue: (card: ItemMetadata, now: Date) => Option.Option<Date>;
}

export const ReviewDuePolicy = Context.GenericTag<ReviewDuePolicy>("@re/workspace/ReviewDuePolicy");

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
  }) => Effect.Effect<ReviewQueue>;
}

export const ReviewQueueBuilder = Context.GenericTag<ReviewQueueBuilder>(
  "@re/workspace/ReviewQueueBuilder",
);

export const ReviewQueueBuilderLive = Layer.effect(
  ReviewQueueBuilder,
  Effect.gen(function* () {
    const deckManager = yield* DeckManager;
    const duePolicy = yield* ReviewDuePolicy;
    const orderingStrategy = yield* QueueOrderingStrategy;
    const pathService = yield* Path.Path;

    return {
      buildQueue: ({ deckPaths, rootPath, now }) =>
        Effect.gen(function* () {
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
                  const dueDate = duePolicy.dueDateIfDue(card, now);
                  if (Option.isSome(dueDate)) {
                    allItems.push({
                      deckPath,
                      deckName,
                      relativePath,
                      item,
                      card,
                      cardIndex,
                      filePosition,
                      category: "due",
                      dueDate: dueDate.value,
                    });
                  }
                }
                filePosition++;
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
