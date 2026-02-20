import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { State, numericField, type ItemId } from "@re/core";
import { Effect, Layer, Random } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeckManagerLive,
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
} from "../src";

const NOW = new Date("2025-01-10T00:00:00Z");

const newCardContent = `<!--@ new123 0 0 0 0-->
What is 2+2?
---
4
`;

const dueCardContent = `<!--@ due456 5 4.5 2 0 2025-01-01T00:00:00Z-->
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

<!--@ card3 5 4.5 2 0 2025-01-01T00:00:00Z-->
Due card 1
---
Answer 3

<!--@ card4 3 4.5 2 0 2025-01-01T00:00:00Z-->
Due card 2 (more overdue)
---
Answer 4
`;

const gapsAContent = `<!--@ a-new 0 0 0 0-->
A new
---
A answer

<!--@ a-not-due 30 4.5 2 0 2025-01-01T00:00:00Z-->
A not due
---
A answer

<!--@ a-due 3 4.5 2 0 2025-01-01T00:00:00Z-->
A due
---
A answer
`;

const gapsBContent = `<!--@ b-not-due 20 4.5 2 0 2025-01-05T00:00:00Z-->
B not due
---
B answer

<!--@ b-new 0 0 0 0-->
B new
---
B answer

<!--@ b-due 1 4.5 2 0 2025-01-01T00:00:00Z-->
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

<!--@ s4 2 4.5 2 0 2025-01-01T00:00:00Z-->
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
    return Effect.fail(
      new SystemError({
        reason: "NotFound",
        module: "FileSystem",
        method: "readFileString",
        pathOrDescriptor: path,
      }),
    );
  },
});

const MockDeckManager = DeckManagerLive.pipe(
  Layer.provide(Layer.mergeAll(MockFileSystem, Path.layer)),
);

const IdentityOrderingStrategy = Layer.succeed(QueueOrderingStrategy, {
  order: (items) => Effect.succeed(items),
});

const BuilderLayer = (orderingLayer: Layer.Layer<QueueOrderingStrategy>) =>
  ReviewQueueBuilderLive.pipe(
    Layer.provide(Layer.mergeAll(MockDeckManager, orderingLayer, Path.layer)),
  );

const runQueue = (input: {
  readonly deckPaths: readonly string[];
  readonly rootPath?: string;
  readonly now?: Date;
  readonly layer: Layer.Layer<ReviewQueueBuilder>;
}) =>
  Effect.gen(function* () {
    const builder = yield* ReviewQueueBuilder;
    return yield* builder.buildQueue({
      deckPaths: input.deckPaths,
      rootPath: input.rootPath ?? "/decks",
      now: input.now ?? NOW,
    });
  }).pipe(Effect.provide(input.layer), Effect.runPromise);

describe("ReviewQueueBuilder", () => {
  it("builds queue from deck paths and soft-skips unreadable decks", async () => {
    const result = await runQueue({
      deckPaths: ["/decks/new.md", "/decks/missing.md", "/decks/due.md"],
      layer: BuilderLayer(IdentityOrderingStrategy),
    });

    expect(result.totalNew).toBe(1);
    expect(result.totalDue).toBe(1);
    expect(result.items.length).toBe(2);
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

  it("NewFirstShuffledSpec shuffles new cards deterministically with a seed", async () => {
    const program = Effect.gen(function* () {
      const builder = yield* ReviewQueueBuilder;
      return yield* builder.buildQueue({
        deckPaths: ["/decks/shuffled.md"],
        rootPath: "/decks",
        now: NOW,
      });
    }).pipe(Effect.provide(SpecLayer(NewFirstShuffledSpec)));

    const result = await Effect.runPromise(program.pipe(Effect.withRandom(Random.make("seed"))));
    expect(result.items.map((item) => item.card.id)).toEqual(["s3", "s1", "s2", "s4"]);
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
      id: id as ItemId,
      stability: numericField(0),
      difficulty: numericField(0),
      state: category === "new" ? State.New : State.Review,
      learningSteps: 0,
      lastReview: null,
      due: null,
    },
    cardIndex: 0,
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

  it("shuffle can be made deterministic with a seeded Random service", async () => {
    const program = shuffle<QueueItem>()([
      makeItem("a", "new", 0),
      makeItem("b", "new", 1),
      makeItem("c", "new", 2),
    ]);

    const result = await Effect.runPromise(program.pipe(Effect.withRandom(Random.make("seed"))));
    expect(result.map((item) => item.card.id)).toEqual(["c", "a", "b"]);
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
    )(items).pipe(Effect.withRandom(Random.make("seed")), Effect.runPromise);

    expect(result[2]?.card.id).toBe("c");
    expect(new Set(result.slice(0, 2).map((item) => item.card.id))).toEqual(new Set(["a", "b"]));
  });
});
