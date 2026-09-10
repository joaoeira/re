import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { makeSystemError } from "./mock-file-system";
import { State, numericField, ItemIdSchema } from "../../src/core/index.js";
import { Effect, Exit, Layer, Random, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeckManager,
  DeckManagerLive,
  DeckReadError,
  DEFAULT_REVIEW_QUEUE_OPTIONS,
  DueFirstByDueDateSpec,
  NewFirstByDueDateSpec,
  NewFirstFileOrderSpec,
  NewFirstShuffledSpec,
  QueueOrderSpec,
  QueueOrderingStrategy,
  QueueOrderingStrategyFromSpec,
  ReviewQueueBuilder,
  ReviewQueueBuilderLive,
  byDueDate,
  byFilePosition,
  chain,
  preserveOrder,
  shuffle,
  sortBy,
  type QueueItem,
  type ReviewQueueOptions,
} from "../../src/workspace/index.js";

const NOW = new Date("2025-01-10T00:00:00Z");

const newCardContent = `<!--@ new123 0 0 0 0-->
What is 2+2?
---
4
`;

const dueCardContent = `<!--@ due456 5 4.5 2 0 2025-01-01T00:00:00Z 2025-01-06T00:00:00.000Z-->
What is the capital?
---
Paris
`;

const mixedContent = `<!--@ card1 0 0 0 0-->
New card 1
---
Answer 1

<!--@ card2 0 0 0 0-->
New card 2
---
Answer 2

<!--@ card3 5 4.5 2 0 2025-01-01T00:00:00Z 2025-01-06T00:00:00.000Z-->
Due card 1
---
Answer 3

<!--@ card4 3 4.5 2 0 2025-01-01T00:00:00Z 2025-01-04T00:00:00.000Z-->
Due card 2 (more overdue)
---
Answer 4
`;

const gapsAContent = `<!--@ a-new 0 0 0 0-->
A new
---
A answer

<!--@ a-not-due 30 4.5 2 0 2025-01-01T00:00:00Z 2025-01-31T00:00:00.000Z-->
A not due
---
A answer

<!--@ a-due 3 4.5 2 0 2025-01-01T00:00:00Z 2025-01-04T00:00:00.000Z-->
A due
---
A answer
`;

const gapsBContent = `<!--@ b-not-due 20 4.5 2 0 2025-01-05T00:00:00Z 2025-01-25T00:00:00.000Z-->
B not due
---
B answer

<!--@ b-new 0 0 0 0-->
B new
---
B answer

<!--@ b-due 1 4.5 2 0 2025-01-01T00:00:00Z 2025-01-02T00:00:00.000Z-->
B due
---
B answer
`;

const shuffledContent = `<!--@ s1 0 0 0 0-->
S1
---
S1

<!--@ s2 0 0 0 0-->
S2
---
S2

<!--@ s3 0 0 0 0-->
S3
---
S3

<!--@ s4 2 4.5 2 0 2025-01-01T00:00:00Z 2025-01-03T00:00:00.000Z-->
S4 due
---
S4
`;

const MockFileSystem = FileSystem.layerNoop({
  readFileString: (path) => {
    if (path === "/decks/new.md") return Effect.succeed(newCardContent);

    if (path === "/decks/due.md") return Effect.succeed(dueCardContent);

    if (path === "/decks/mixed.md") return Effect.succeed(mixedContent);

    if (path === "/decks/gaps-a.md") return Effect.succeed(gapsAContent);

    if (path === "/decks/gaps-b.md") return Effect.succeed(gapsBContent);

    if (path === "/decks/shuffled.md") return Effect.succeed(shuffledContent);

    if (path === "/decks/broken.md") return Effect.succeed("<!--@ bad metadata-->\n");

    if (path === "/decks/empty.md") return Effect.succeed("# No cards yet\n");

    return Effect.fail(makeSystemError("NotFound", "readFileString", path));
  },
});

const MockDeckManager = DeckManagerLive.pipe(
  Layer.provide(Layer.mergeAll(MockFileSystem, Path.layer)),
);

const IdentityOrderingStrategy = Layer.succeed(QueueOrderingStrategy, {
  order: (items) => Effect.succeed(items),
});

const BuilderLayer = (
  orderingLayer: Layer.Layer<QueueOrderingStrategy>,
  deckManagerLayer: Layer.Layer<DeckManager> = MockDeckManager,
) =>
  ReviewQueueBuilderLive.pipe(
    Layer.provide(Layer.mergeAll(deckManagerLayer, orderingLayer, Path.layer)),
  );

const runQueue = (input: {
  readonly deckPaths: readonly string[];
  readonly rootPath?: string;
  readonly now?: Date;
  readonly options?: ReviewQueueOptions;
  readonly layer: Layer.Layer<ReviewQueueBuilder>;
}) =>
  Effect.gen(function* () {
    const builder = yield* ReviewQueueBuilder;

    return yield* builder.buildQueue({
      deckPaths: input.deckPaths,
      rootPath: input.rootPath ?? "/decks",
      now: input.now ?? NOW,
      options: input.options,
    });
  }).pipe(Effect.provide(input.layer), Effect.runPromise);

describe("ReviewQueueBuilder", () => {
  it("reports every deck failure in input order while filtering and limiting usable cards", async () => {
    const result = await Effect.gen(function* () {
      const decks = yield* DeckManager;

      const delayedDecks = Layer.succeed(DeckManager, {
        ...decks,
        readDeck: (deckPath) =>
          deckPath === "/decks/blocked.md"
            ? Effect.yieldNow.pipe(
                Effect.andThen(
                  Effect.fail(new DeckReadError({ deckPath, message: "Deck is locked" })),
                ),
              )
            : decks.readDeck(deckPath),
      });

      return yield* Effect.gen(function* () {
        const builder = yield* ReviewQueueBuilder;

        return yield* builder.buildQueue({
          deckPaths: [
            "/decks/blocked.md",
            "/decks/mixed.md",
            "/decks/missing.md",
            "/decks/broken.md",
            "/decks/missing.md",
            "/decks/empty.md",
          ],
          rootPath: "/decks",
          now: NOW,
          options: {
            ...DEFAULT_REVIEW_QUEUE_OPTIONS,
            includeNew: false,
            cardLimit: 1,
            order: "due-first",
          },
        });
      }).pipe(Effect.provide(BuilderLayer(IdentityOrderingStrategy, delayedDecks)));
    }).pipe(Effect.provide(MockDeckManager), Effect.runPromise);

    expect(result.items.map((item) => item.card.id)).toEqual(["card4"]);
    expect(result.totalNew).toBe(0);
    expect(result.totalDue).toBe(1);
    expect(result.deckErrors.map((error) => error._tag)).toEqual([
      "DeckReadError",
      "DeckNotFound",
      "DeckParseError",
      "DeckNotFound",
    ]);
    expect(result.deckErrors).toMatchObject([
      { deckPath: "/decks/blocked.md", message: "Deck is locked" },
      { deckPath: "/decks/missing.md" },
      { deckPath: "/decks/broken.md" },
      { deckPath: "/decks/missing.md" },
    ]);
  });

  it("distinguishes an empty deck from failed reads, even with a zero card limit", async () => {
    const empty = await runQueue({
      deckPaths: ["/decks/empty.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
    });

    const failed = await runQueue({
      deckPaths: ["/decks/missing.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
      options: { ...DEFAULT_REVIEW_QUEUE_OPTIONS, cardLimit: 0 },
    });

    expect(empty.items).toEqual([]);
    expect(empty.deckErrors).toEqual([]);
    expect(failed.items).toEqual([]);
    expect(failed.deckErrors).toHaveProperty("0._tag", "DeckNotFound");
    expect(failed.deckErrors).toMatchObject([{ deckPath: "/decks/missing.md" }]);
  });

  it("propagates defects and interruption instead of reporting successful partial queues", async () => {
    const defect = new Error("Filesystem implementation failed");

    for (const [kind, failure] of [
      ["defect", Effect.die(defect)],
      ["interruption", Effect.interrupt],
    ] as const) {
      const decks = DeckManagerLive.pipe(
        Layer.provide(
          Layer.merge(FileSystem.layerNoop({ readFileString: () => failure }), Path.layer),
        ),
      );

      const exit = await Effect.gen(function* () {
        const builder = yield* ReviewQueueBuilder;

        return yield* builder.buildQueue({
          deckPaths: ["/decks/unavailable.md"],
          rootPath: "/decks",
          now: NOW,
        });
      }).pipe(Effect.provide(BuilderLayer(IdentityOrderingStrategy, decks)), Effect.runPromiseExit);

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        if (kind === "interruption") {
          expect(Exit.hasInterrupts(exit)).toBe(true);
        } else {
          expect(Result.getOrUndefined(Exit.findDefect(exit))).toBe(defect);
        }
      }
    }
  });

  it("keeps output stable with caller deckPaths order and does not deduplicate", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/due.md", "/decks/new.md", "/decks/new.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
    });

    expect(result.items.map((item) => item.deckPath)).toEqual([
      "/decks/due.md",
      "/decks/new.md",
      "/decks/new.md",
    ]);
    expect(result.totalNew).toBe(2);
    expect(result.totalDue).toBe(1);
  });

  it("preserves global filePosition across decks, including skipped cards", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/gaps-a.md", "/decks/gaps-b.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
    });

    expect(result.items.map((item) => item.card.id)).toEqual(["a-new", "a-due", "b-new", "b-due"]);
    expect(result.items.map((item) => item.filePosition)).toEqual([0, 2, 4, 5]);
  });

  it("filters queue items by requested card categories", async () => {
    const dueOnly = await runQueue({
      deckPaths: ["/decks/mixed.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
      options: {
        ...DEFAULT_REVIEW_QUEUE_OPTIONS,
        includeNew: false,
      },
    });

    expect(dueOnly.items.map((item) => item.category)).toEqual(["due", "due"]);
    expect(dueOnly.totalNew).toBe(0);
    expect(dueOnly.totalDue).toBe(2);

    const newOnly = await runQueue({
      deckPaths: ["/decks/mixed.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
      options: {
        ...DEFAULT_REVIEW_QUEUE_OPTIONS,
        includeDue: false,
      },
    });

    expect(newOnly.items.map((item) => item.category)).toEqual(["new", "new"]);
    expect(newOnly.totalNew).toBe(2);
    expect(newOnly.totalDue).toBe(0);
  });

  it("applies explicit ordering before truncating to the session limit", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/mixed.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
      options: {
        ...DEFAULT_REVIEW_QUEUE_OPTIONS,
        cardLimit: 1,
        order: "due-first",
      },
    });

    expect(result.items.map((item) => item.card.id)).toEqual(["card4"]);
    expect(result.totalNew).toBe(0);
    expect(result.totalDue).toBe(1);
  });

  it("orders new cards first when requested", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/mixed.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
      options: {
        ...DEFAULT_REVIEW_QUEUE_OPTIONS,
        order: "new-first",
      },
    });

    expect(result.items.map((item) => item.card.id)).toEqual(["card1", "card2", "card4", "card3"]);
  });
});

describe("ReviewQueue ordering from spec", () => {
  const SpecLayer = (specLayer: Layer.Layer<typeof QueueOrderSpec.Service>) =>
    BuilderLayer(QueueOrderingStrategyFromSpec.pipe(Layer.provide(specLayer)));

  it("NewFirstByDueDateSpec places new cards before due cards", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/mixed.md"],
      layer: SpecLayer(NewFirstByDueDateSpec),
    });

    let seenDue = false;

    for (const item of result.items) {
      if (item.category === "due") seenDue = true;

      if (item.category === "new" && seenDue) {
        throw new Error("New card found after due card");
      }
    }
  });

  it("DueFirstByDueDateSpec places due cards before new cards", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/mixed.md"],
      layer: SpecLayer(DueFirstByDueDateSpec),
    });

    let seenNew = false;

    for (const item of result.items) {
      if (item.category === "new") seenNew = true;

      if (item.category === "due" && seenNew) {
        throw new Error("Due card found after new card");
      }
    }
  });

  it("NewFirstShuffledSpec shuffles within the new group before applying the limit", async () => {
    const build = (cardLimit: number | null = null) =>
      Effect.gen(function* () {
        const builder = yield* ReviewQueueBuilder;

        return yield* builder.buildQueue({
          deckPaths: ["/decks/shuffled.md"],
          rootPath: "/decks",
          now: NOW,
          options: { ...DEFAULT_REVIEW_QUEUE_OPTIONS, cardLimit },
        });
      }).pipe(Effect.provide(SpecLayer(NewFirstShuffledSpec)));

    const orderings: string[] = [];

    for (const seed of ["seed", "second", "third", "fourth"]) {
      const result = await Effect.runPromise(build().pipe(Random.withSeed(seed)));
      const ids = result.items.map((item) => item.card.id);
      expect(ids.slice(0, 3).sort()).toEqual(["s1", "s2", "s3"]);
      expect(ids[3]).toBe("s4");
      const limited = await Effect.runPromise(build(2).pipe(Random.withSeed(seed)));
      expect(limited.items.map((item) => item.card.id)).toEqual(ids.slice(0, 2));
      orderings.push(ids.join(","));
    }

    expect(new Set(orderings).size).toBeGreaterThan(1);
  });

  it("NewFirstFileOrderSpec sorts new cards by file position", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/mixed.md"],
      layer: SpecLayer(NewFirstFileOrderSpec),
    });

    const newCards = result.items.filter((item) => item.category === "new");
    expect(newCards[0]?.card.id).toBe("card1");
    expect(newCards[1]?.card.id).toBe("card2");
  });
});

describe("Composable ordering primitives", () => {
  const makeItem = (
    id: string,
    category: "new" | "due",
    filePosition: number,
    dueDate: Date | null = null,
    deckPath: string = "/deck.md",
  ): QueueItem => ({
    deckPath,
    deckName: "deck",
    relativePath: "deck.md",
    item: { content: "", cards: [] },
    card: {
      id: Schema.decodeSync(ItemIdSchema)(id),
      stability: numericField(0),
      difficulty: numericField(0),
      state: category === "new" ? State.New : State.Review,
      learningSteps: 0,
      lastReview: null,
      due: null,
    },
    filePosition,
    category,
    dueDate,
  });

  it("preserveOrder returns items unchanged", async () => {
    const items = [makeItem("a", "new", 0), makeItem("b", "new", 1), makeItem("c", "new", 2)];
    const result = await preserveOrder<QueueItem>()(items).pipe(Effect.runPromise);
    expect(result.map((item) => item.card.id)).toEqual(["a", "b", "c"]);
  });

  it("sortBy supports file position and due date orderings", async () => {
    const byPos = await sortBy<QueueItem>(byFilePosition)([
      makeItem("c", "new", 2),
      makeItem("a", "new", 0),
      makeItem("b", "new", 1),
    ]).pipe(Effect.runPromise);

    expect(byPos.map((item) => item.card.id)).toEqual(["a", "b", "c"]);

    const byDue = await sortBy<QueueItem>(byDueDate)([
      makeItem("late", "due", 0, new Date("2025-01-10")),
      makeItem("early", "due", 1, new Date("2025-01-01")),
      makeItem("mid", "due", 2, new Date("2025-01-05")),
    ]).pipe(Effect.runPromise);

    expect(byDue.map((item) => item.card.id)).toEqual(["early", "mid", "late"]);
  });

  it("shuffle preserves the input and multiplicity and is reproducible with a seed", async () => {
    const items = [makeItem("a", "new", 0), makeItem("b", "new", 1), makeItem("c", "new", 2)];
    items.push(items[0]!);
    const before = [...items];
    const program = shuffle<QueueItem>()(items);
    const orderings: string[] = [];

    for (const seed of ["seed", "second", "third", "fourth"]) {
      const first = await Effect.runPromise(program.pipe(Random.withSeed(seed)));
      const again = await Effect.runPromise(program.pipe(Random.withSeed(seed)));
      expect(first).toEqual(again);
      expect(first.map((item) => item.card.id).sort()).toEqual(["a", "a", "b", "c"]);
      expect(items).toEqual(before);
      orderings.push(first.map((item) => item.card.id).join(","));
    }

    expect(new Set(orderings).size).toBeGreaterThan(1);
  });

  it("chain composes multiple order steps", async () => {
    const items = [
      makeItem("a", "due", 0, new Date("2025-01-01")),
      makeItem("b", "due", 1, new Date("2025-01-01")),
      makeItem("c", "due", 2, new Date("2025-01-05")),
    ];

    const result = await chain(
      shuffle<QueueItem>(),
      sortBy(byDueDate),
    )(items).pipe(Random.withSeed("seed"), Effect.runPromise);

    expect(result[2]?.card.id).toBe("c");
    expect(new Set(result.slice(0, 2).map((item) => item.card.id))).toEqual(new Set(["a", "b"]));
  });
});
