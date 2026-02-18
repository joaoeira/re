import { describe, it, expect } from "vitest";
import { Effect, Layer, Option, Random } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { State, numericField, type ItemId, type ItemMetadata } from "@re/core";
import {
  ReviewQueueService,
  ReviewQueueServiceLive,
  ReviewQueueLive,
  SchedulerDuePolicyLive,
  type Selection,
} from "../../src/services/ReviewQueue";
import {
  type DeckTreeNode,
  NewFirstOrderingStrategy,
  DueFirstOrderingStrategy,
  QueueOrderingStrategy,
  QueueOrderingStrategyFromSpec,
  NewFirstByDueDateSpec,
  DueFirstByDueDateSpec,
  NewFirstShuffledSpec,
  NewFirstFileOrderSpec,
  QueueOrderSpec,
  preserveOrder,
  sortBy,
  shuffle,
  chain,
  byDueDate,
  byFilePosition,
  type QueueItem,
  buildDeckTree,
  DeckManager,
  DeckManagerLive,
  ReviewDuePolicy,
  Scheduler,
  SchedulerLive,
} from "@re/workspace";

// New card (state=0)
const newCardContent = `<!--@ new123 0 0 0 0-->
What is 2+2?
---
4
`;

// Due card (state=2, due 5 days ago)
const dueCardContent = `<!--@ due456 5 4.5 2 0 2025-01-01T00:00:00Z-->
What is the capital?
---
Paris
`;

// Multiple cards - some new, some due
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

const brokenContent = "<!--@ bad metadata-->";

const MockFileSystem = FileSystem.layerNoop({
  readFileString: (path) => {
    if (path === "/decks/new.md") return Effect.succeed(newCardContent);
    if (path === "/decks/due.md") return Effect.succeed(dueCardContent);
    if (path === "/decks/mixed.md") return Effect.succeed(mixedContent);
    if (path === "/decks/broken.md") return Effect.succeed(brokenContent);
    if (path === "/decks/empty.md") return Effect.succeed("# No cards");
    if (path === "/decks/folder1/a.md") return Effect.succeed(newCardContent);
    if (path === "/decks/folder1/b.md") return Effect.succeed(dueCardContent);
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

const TestLayer = ReviewQueueServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(MockDeckManager, SchedulerLive, NewFirstOrderingStrategy, Path.layer),
  ),
);

const DueFirstTestLayer = ReviewQueueServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(MockDeckManager, SchedulerLive, DueFirstOrderingStrategy, Path.layer),
  ),
);

// Helper to build a simple tree structure for testing
const buildTestTree = (): DeckTreeNode[] =>
  buildDeckTree([
    {
      status: "ok",
      absolutePath: "/decks/new.md",
      relativePath: "new.md",
      name: "new",
      totalCards: 1,
      dueCards: 0,
      stateCounts: { new: 1, learning: 0, review: 0, relearning: 0 },
    },
    {
      status: "ok",
      absolutePath: "/decks/due.md",
      relativePath: "due.md",
      name: "due",
      totalCards: 1,
      dueCards: 1,
      stateCounts: { new: 0, learning: 0, review: 1, relearning: 0 },
    },
    {
      status: "ok",
      absolutePath: "/decks/mixed.md",
      relativePath: "mixed.md",
      name: "mixed",
      totalCards: 4,
      dueCards: 2,
      stateCounts: { new: 2, learning: 0, review: 2, relearning: 0 },
    },
    {
      status: "ok",
      absolutePath: "/decks/folder1/a.md",
      relativePath: "folder1/a.md",
      name: "a",
      totalCards: 1,
      dueCards: 0,
      stateCounts: { new: 1, learning: 0, review: 0, relearning: 0 },
    },
    {
      status: "ok",
      absolutePath: "/decks/folder1/b.md",
      relativePath: "folder1/b.md",
      name: "b",
      totalCards: 1,
      dueCards: 1,
      stateCounts: { new: 0, learning: 0, review: 1, relearning: 0 },
    },
    {
      status: "parse_error",
      absolutePath: "/decks/broken.md",
      relativePath: "broken.md",
      name: "broken",
      message: "Invalid metadata at line 1",
    },
  ]);

describe("ReviewQueueService", () => {
  const now = new Date("2025-01-10T00:00:00Z"); // Cards due after Jan 1 + stability days

  describe("Selection types", () => {
    it("builds queue for 'all' selection", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "all" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      // Should include all new and due cards from all decks
      // new.md: 1 new, due.md: 1 due, mixed.md: 2 new + 2 due, folder1/a.md: 1 new, folder1/b.md: 1 due
      expect(result.totalNew).toBe(4); // 1 + 2 + 1
      expect(result.totalDue).toBe(4); // 1 + 2 + 1
      expect(result.items.length).toBe(8);
    });

    it("builds queue for single deck selection", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.totalNew).toBe(2);
      expect(result.totalDue).toBe(2);
      expect(result.items.length).toBe(4);
    });

    it("builds queue for folder selection", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "folder", path: "folder1" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      // folder1 contains: a.md (1 new) + b.md (1 due)
      expect(result.totalNew).toBe(1);
      expect(result.totalDue).toBe(1);
      expect(result.items.length).toBe(2);
    });
  });

  describe("Ordering strategies", () => {
    it("NewFirstOrdering places new cards before due cards", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      // First items should be new, then due
      const newCount = result.items.filter((i) => i.category === "new").length;
      expect(newCount).toBe(2);

      // Check ordering: all new cards come before due cards
      let seenDue = false;
      for (const item of result.items) {
        if (item.category === "due") seenDue = true;
        if (item.category === "new" && seenDue) {
          throw new Error("New card found after due card in NewFirst ordering");
        }
      }
    });

    it("DueFirstOrdering places due cards before new cards", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(DueFirstTestLayer), Effect.runPromise);

      // Check ordering: all due cards come before new cards
      let seenNew = false;
      for (const item of result.items) {
        if (item.category === "new") seenNew = true;
        if (item.category === "due" && seenNew) {
          throw new Error("Due card found after new card in DueFirst ordering");
        }
      }
    });

    it("sorts due cards by due date (earliest first)", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      const dueCards = result.items.filter((i) => i.category === "due");
      expect(dueCards.length).toBe(2);

      // card4 has stability 3, card3 has stability 5
      // Both have lastReview 2025-01-01, so:
      // card4 due: Jan 1 + 3 days = Jan 4
      // card3 due: Jan 1 + 5 days = Jan 6
      // card4 should come first (more overdue)
      expect(dueCards[0]?.card.id).toBe("card4");
      expect(dueCards[1]?.card.id).toBe("card3");
    });
  });

  describe("QueueItem structure", () => {
    it("includes all required fields", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "new.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.items.length).toBe(1);
      const item = result.items[0]!;

      expect(item.deckPath).toBe("/decks/new.md");
      expect(item.deckName).toBe("new");
      expect(item.relativePath).toBe("new.md");
      expect(item.card.id).toBe("new123");
      expect(item.cardIndex).toBe(0);
      expect(item.category).toBe("new");
      expect(item.dueDate).toBeNull(); // New cards have no due date
      expect(item.item.content).toContain("What is 2+2?");
    });

    it("includes relative path from root", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "folder", path: "folder1" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      const itemA = result.items.find((i) => i.deckPath === "/decks/folder1/a.md");
      const itemB = result.items.find((i) => i.deckPath === "/decks/folder1/b.md");

      expect(itemA?.relativePath).toBe("folder1/a.md");
      expect(itemB?.relativePath).toBe("folder1/b.md");
    });
  });

  describe("Edge cases", () => {
    it("returns empty queue for empty tree", async () => {
      const selection: Selection = { type: "all" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, [], "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.items.length).toBe(0);
      expect(result.totalNew).toBe(0);
      expect(result.totalDue).toBe(0);
    });

    it("handles non-existent deck path gracefully", async () => {
      const tree = buildDeckTree([
        {
          status: "ok" as const,
          absolutePath: "/decks/nonexistent.md",
          relativePath: "nonexistent.md",
          name: "nonexistent",
          totalCards: 1,
          dueCards: 0,
          stateCounts: { new: 1, learning: 0, review: 0, relearning: 0 },
        },
      ]);
      const selection: Selection = { type: "all" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      // Should return empty since file doesn't exist
      expect(result.items.length).toBe(0);
    });

    it("handles selection for non-matching path", async () => {
      const tree = buildTestTree();
      const selection: Selection = {
        type: "deck",
        path: "nonexistent.md",
      };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.items.length).toBe(0);
    });

    it("soft-skips error snapshot leaves during queue construction", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "all" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.totalNew).toBe(4);
      expect(result.totalDue).toBe(4);
      expect(result.items.some((item) => item.deckPath === "/decks/broken.md")).toBe(false);
    });
  });

  describe("Spec-based ordering (QueueOrderingStrategyFromSpec)", () => {
    const SpecBasedTestLayer = (specLayer: Layer.Layer<typeof QueueOrderSpec.Service>) =>
      ReviewQueueServiceLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            MockDeckManager,
            SchedulerLive,
            Path.layer,
            QueueOrderingStrategyFromSpec.pipe(Layer.provide(specLayer)),
          ),
        ),
      );

    it("NewFirstByDueDateSpec places new cards before due cards", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(SpecBasedTestLayer(NewFirstByDueDateSpec)), Effect.runPromise);

      let seenDue = false;
      for (const item of result.items) {
        if (item.category === "due") seenDue = true;
        if (item.category === "new" && seenDue) {
          throw new Error("New card found after due card");
        }
      }
    });

    it("DueFirstByDueDateSpec places due cards before new cards", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(SpecBasedTestLayer(DueFirstByDueDateSpec)), Effect.runPromise);

      let seenNew = false;
      for (const item of result.items) {
        if (item.category === "new") seenNew = true;
        if (item.category === "due" && seenNew) {
          throw new Error("Due card found after new card");
        }
      }
    });

    it("NewFirstShuffledSpec randomizes new card order", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const runOnce = () =>
        Effect.gen(function* () {
          const service = yield* ReviewQueueService;
          return yield* service.buildQueue(selection, tree, "/decks", now);
        }).pipe(Effect.provide(SpecBasedTestLayer(NewFirstShuffledSpec)));

      const results = await Effect.all([
        runOnce(),
        runOnce(),
        runOnce(),
        runOnce(),
        runOnce(),
      ]).pipe(Effect.runPromise);

      for (const result of results) {
        expect(result.totalNew).toBe(2);
        expect(result.totalDue).toBe(2);
        let seenDue = false;
        for (const item of result.items) {
          if (item.category === "due") seenDue = true;
          if (item.category === "new" && seenDue) {
            throw new Error("New card found after due card");
          }
        }
      }
    });

    it("NewFirstFileOrderSpec sorts by file position", async () => {
      const tree = buildTestTree();
      const selection: Selection = { type: "deck", path: "mixed.md" };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(SpecBasedTestLayer(NewFirstFileOrderSpec)), Effect.runPromise);

      const newCards = result.items.filter((i) => i.category === "new");
      expect(newCards[0]?.card.id).toBe("card1");
      expect(newCards[1]?.card.id).toBe("card2");
    });
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

  describe("preserveOrder", () => {
    it("returns items in original order", async () => {
      const items = [makeItem("a", "new", 0), makeItem("b", "new", 1), makeItem("c", "new", 2)];

      const result = await preserveOrder<QueueItem>()(items).pipe(Effect.runPromise);

      expect(result.map((i) => i.card.id)).toEqual(["a", "b", "c"]);
    });
  });

  describe("sortBy", () => {
    it("sorts by the given order", async () => {
      const items = [makeItem("c", "new", 2), makeItem("a", "new", 0), makeItem("b", "new", 1)];

      const result = await sortBy<QueueItem>(byFilePosition)(items).pipe(Effect.runPromise);

      expect(result.map((i) => i.card.id)).toEqual(["a", "b", "c"]);
    });

    it("sorts by due date", async () => {
      const items = [
        makeItem("late", "due", 0, new Date("2025-01-10")),
        makeItem("early", "due", 1, new Date("2025-01-01")),
        makeItem("mid", "due", 2, new Date("2025-01-05")),
      ];

      const result = await sortBy<QueueItem>(byDueDate)(items).pipe(Effect.runPromise);

      expect(result.map((i) => i.card.id)).toEqual(["early", "mid", "late"]);
    });
  });

  describe("shuffle", () => {
    it("returns all items (possibly in different order)", async () => {
      const items = [
        makeItem("a", "new", 0),
        makeItem("b", "new", 1),
        makeItem("c", "new", 2),
        makeItem("d", "new", 3),
        makeItem("e", "new", 4),
      ];

      const result = await shuffle<QueueItem>()(items).pipe(Effect.runPromise);

      expect(result.length).toBe(5);
      expect(new Set(result.map((i) => i.card.id))).toEqual(new Set(["a", "b", "c", "d", "e"]));
    });
  });

  describe("chain", () => {
    it("applies multiple transforms in sequence", async () => {
      const items = [makeItem("c", "new", 2), makeItem("a", "new", 0), makeItem("b", "new", 1)];

      const sortThenPreserve = chain(sortBy<QueueItem>(byFilePosition), preserveOrder());

      const result = await sortThenPreserve(items).pipe(Effect.runPromise);

      expect(result.map((i) => i.card.id)).toEqual(["a", "b", "c"]);
    });

    it("allows chaining shuffle with sort for deterministic tiebreaking", async () => {
      const items = [
        makeItem("a", "due", 0, new Date("2025-01-01")),
        makeItem("b", "due", 1, new Date("2025-01-01")),
        makeItem("c", "due", 2, new Date("2025-01-05")),
      ];

      const shuffleThenSortByDue = chain(shuffle<QueueItem>(), sortBy(byDueDate));

      const result = await shuffleThenSortByDue(items).pipe(Effect.runPromise);

      expect(result[2]?.card.id).toBe("c");
      const firstTwo = result.slice(0, 2).map((i) => i.card.id);
      expect(new Set(firstTwo)).toEqual(new Set(["a", "b"]));
    });
  });

  describe("custom QueueOrderSpec", () => {
    it("allows defining custom specs with composed orderings", async () => {
      const items = [
        makeItem("new1", "new", 0),
        makeItem("due1", "due", 1, new Date("2025-01-05")),
        makeItem("new2", "new", 2),
        makeItem("due2", "due", 3, new Date("2025-01-01")),
      ];

      const newItems = items.filter((i) => i.category === "new");
      const dueItems = items.filter((i) => i.category === "due");

      const dueCardOrder = chain(shuffle<QueueItem>(), sortBy(byDueDate));
      const orderedDue = await dueCardOrder(dueItems).pipe(Effect.runPromise);

      expect(orderedDue[0]?.card.id).toBe("due2");
      expect(orderedDue[1]?.card.id).toBe("due1");

      const orderedNew = await shuffle<QueueItem>()(newItems).pipe(Effect.runPromise);
      expect(orderedNew.length).toBe(2);
      expect(new Set(orderedNew.map((i) => i.card.id))).toEqual(new Set(["new1", "new2"]));
    });
  });
});

describe("SchedulerDuePolicyLive", () => {
  const makeCard = (
    state: State,
    stability: number,
    learningSteps: number,
    lastReview: Date | null,
  ): ItemMetadata => ({
    id: `card-${state}-${stability}-${learningSteps}` as ItemId,
    stability: numericField(stability),
    difficulty: numericField(5),
    state,
    learningSteps,
    lastReview,
    due: null,
  });

  it("matches Scheduler due semantics across card states", async () => {
    const now = new Date("2025-01-10T12:00:00Z");

    const program = Effect.gen(function* () {
      const duePolicy = yield* ReviewDuePolicy;
      const scheduler = yield* Scheduler;

      const cases: ItemMetadata[] = [
        makeCard(State.New, 0, 0, null),
        makeCard(State.Review, 2, 0, new Date("2025-01-01T12:00:00Z")),
        makeCard(State.Review, 20, 0, new Date("2025-01-09T12:00:00Z")),
        makeCard(State.Learning, 0, 0, new Date("2025-01-10T11:50:00Z")),
        makeCard(State.Learning, 0, 1, new Date("2025-01-10T11:58:00Z")),
        makeCard(State.Relearning, 0, 0, new Date("2025-01-10T11:30:00Z")),
        makeCard(State.Relearning, 0, 0, new Date("2025-01-10T12:05:00Z")),
      ];

      for (const card of cases) {
        const expectedIsDue = scheduler.isDue(card, now);
        const expectedDate = scheduler.getReviewDate(card);
        const actual = duePolicy.dueDateIfDue(card, now);

        if (expectedIsDue && expectedDate) {
          expect(Option.isSome(actual)).toBe(true);
          if (Option.isSome(actual)) {
            expect(actual.value.toISOString()).toBe(expectedDate.toISOString());
          }
        } else {
          expect(Option.isNone(actual)).toBe(true);
        }
      }
    });

    const testLayer = Layer.mergeAll(
      SchedulerLive,
      SchedulerDuePolicyLive.pipe(Layer.provide(SchedulerLive)),
    );

    await program.pipe(Effect.provide(testLayer), Effect.runPromise);
  });
});

describe("ReviewQueue default strategy", () => {
  it("ReviewQueueLive uses shuffled ordering by default", async () => {
    const tree = buildTestTree();
    const selection: Selection = { type: "deck", path: "mixed.md" };
    const now = new Date("2025-01-10T00:00:00Z");

    const program = Effect.gen(function* () {
      const service = yield* ReviewQueueService;
      return yield* service.buildQueue(selection, tree, "/decks", now);
    }).pipe(
      Effect.provide(
        ReviewQueueLive.pipe(
          Layer.provide(Layer.mergeAll(MockDeckManager, SchedulerLive, Path.layer)),
        ),
      ),
    );

    const result = await Effect.runPromise(program.pipe(Effect.withRandom(Random.make("seed"))));
    expect(result.items.map((item) => item.card.id)).toEqual(["card4", "card1", "card3", "card2"]);
  });
});

describe("ReviewQueue integration harness", () => {
  const collectDeckPathsBaseline = (
    selection: Selection,
    tree: readonly DeckTreeNode[],
  ): string[] => {
    const paths: string[] = [];

    const collectFromNode = (node: DeckTreeNode): void => {
      if (node.kind === "leaf") {
        paths.push(node.snapshot.absolutePath);
      } else if (node.kind === "group") {
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
        if (node.kind === "group") {
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

  const buildLegacyQueue = (
    selection: Selection,
    tree: readonly DeckTreeNode[],
    rootPath: string,
    now: Date,
  ) =>
    Effect.gen(function* () {
      const deckManager = yield* DeckManager;
      const scheduler = yield* Scheduler;
      const orderingStrategy = yield* QueueOrderingStrategy;
      const pathService = yield* Path.Path;

      const deckPaths = collectDeckPathsBaseline(selection, tree);
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
            const isNew = card.state === State.New;
            const isDue = !isNew && scheduler.isDue(card, now);

            if (isNew || isDue) {
              allItems.push({
                deckPath,
                deckName,
                relativePath,
                item,
                card,
                cardIndex,
                filePosition,
                category: isNew ? "new" : "due",
                dueDate: scheduler.getReviewDate(card),
              });
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
    });

  const normalizeQueue = (queue: {
    items: readonly QueueItem[];
    totalNew: number;
    totalDue: number;
  }) => ({
    totalNew: queue.totalNew,
    totalDue: queue.totalDue,
    items: queue.items.map((item) => ({
      deckPath: item.deckPath,
      cardId: item.card.id,
      cardIndex: item.cardIndex,
      filePosition: item.filePosition,
      category: item.category,
      dueDate: item.dueDate ? item.dueDate.toISOString() : null,
      relativePath: item.relativePath,
      deckName: item.deckName,
    })),
  });

  it("matches baseline queue output for the same selection", async () => {
    const tree = buildTestTree();
    const selection: Selection = { type: "all" };
    const now = new Date("2025-01-10T00:00:00Z");

    const newQueue = await Effect.gen(function* () {
      const service = yield* ReviewQueueService;
      return yield* service.buildQueue(selection, tree, "/decks", now);
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    const legacyQueue = await buildLegacyQueue(selection, tree, "/decks", now).pipe(
      Effect.provide(
        Layer.mergeAll(MockDeckManager, SchedulerLive, NewFirstOrderingStrategy, Path.layer),
      ),
      Effect.runPromise,
    );

    expect(normalizeQueue(newQueue)).toEqual(normalizeQueue(legacyQueue));
  });
});
