import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import {
  ReviewQueueService,
  ReviewQueueServiceLive,
  NewFirstOrderingStrategy,
  DueFirstOrderingStrategy,
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
  type Selection,
  type QueueItem,
} from "../../src/services/ReviewQueue";
import { DeckManagerLive } from "@re/workspace";
import { SchedulerLive } from "../../src/services/Scheduler";
import type { DeckTreeNode } from "../../src/services";

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

const MockFileSystem = FileSystem.layerNoop({
  readFileString: (path) => {
    if (path === "/decks/new.md") return Effect.succeed(newCardContent);
    if (path === "/decks/due.md") return Effect.succeed(dueCardContent);
    if (path === "/decks/mixed.md") return Effect.succeed(mixedContent);
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
const buildTestTree = (): DeckTreeNode[] => [
  {
    type: "deck",
    stats: {
      path: "/decks/new.md",
      name: "new",
      totalCards: 1,
      newCards: 1,
      dueCards: 0,
      isEmpty: false,
      parseError: null,
    },
  },
  {
    type: "deck",
    stats: {
      path: "/decks/due.md",
      name: "due",
      totalCards: 1,
      newCards: 0,
      dueCards: 1,
      isEmpty: false,
      parseError: null,
    },
  },
  {
    type: "deck",
    stats: {
      path: "/decks/mixed.md",
      name: "mixed",
      totalCards: 4,
      newCards: 2,
      dueCards: 2,
      isEmpty: false,
      parseError: null,
    },
  },
  {
    type: "folder",
    name: "folder1",
    path: "/decks/folder1",
    children: [
      {
        type: "deck",
        stats: {
          path: "/decks/folder1/a.md",
          name: "a",
          totalCards: 1,
          newCards: 1,
          dueCards: 0,
          isEmpty: false,
          parseError: null,
        },
      },
      {
        type: "deck",
        stats: {
          path: "/decks/folder1/b.md",
          name: "b",
          totalCards: 1,
          newCards: 0,
          dueCards: 1,
          isEmpty: false,
          parseError: null,
        },
      },
    ],
  },
];

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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
      const selection: Selection = { type: "folder", path: "/decks/folder1" };

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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
      const selection: Selection = { type: "deck", path: "/decks/new.md" };

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
      const selection: Selection = { type: "folder", path: "/decks/folder1" };

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
      const tree: DeckTreeNode[] = [
        {
          type: "deck",
          stats: {
            path: "/decks/nonexistent.md",
            name: "nonexistent",
            totalCards: 1,
            newCards: 1,
            dueCards: 0,
            isEmpty: false,
            parseError: null,
          },
        },
      ];
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
        path: "/decks/nonexistent.md",
      };

      const result = await Effect.gen(function* () {
        const service = yield* ReviewQueueService;
        return yield* service.buildQueue(selection, tree, "/decks", now);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.items.length).toBe(0);
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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
      const selection: Selection = { type: "deck", path: "/decks/mixed.md" };

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
    item: { type: "qa", content: "", cards: [] } as any,
    card: { id, state: category === "new" ? 0 : 2 } as any,
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
