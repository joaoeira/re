import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Effect, Layer, Random } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeckManagerLive,
  NewFirstOrderingStrategy,
  ReviewQueueLive,
  ReviewQueueService,
  ReviewQueueServiceLive,
  buildDeckTree,
  collectDeckPathsFromSelection,
  type DeckTreeNode,
  type ReviewQueueSelection,
} from "../src";

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

const brokenContent = "<!--@ bad metadata-->";

const MockFileSystem = FileSystem.layerNoop({
  readFileString: (path) => {
    if (path === "/decks/new.md") return Effect.succeed(newCardContent);
    if (path === "/decks/due.md") return Effect.succeed(dueCardContent);
    if (path === "/decks/mixed.md") return Effect.succeed(mixedContent);
    if (path === "/decks/folder1/a.md") return Effect.succeed(newCardContent);
    if (path === "/decks/folder1/b.md") return Effect.succeed(dueCardContent);
    if (path === "/decks/broken.md") return Effect.succeed(brokenContent);
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
  Layer.provide(Layer.mergeAll(MockDeckManager, NewFirstOrderingStrategy, Path.layer)),
);

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

describe("collectDeckPathsFromSelection", () => {
  it("collects deck paths for all selection from the workspace tree", () => {
    const tree = buildTestTree();
    const selection: ReviewQueueSelection = { type: "all" };

    expect(collectDeckPathsFromSelection(selection, tree)).toEqual([
      "/decks/folder1/a.md",
      "/decks/folder1/b.md",
      "/decks/broken.md",
      "/decks/due.md",
      "/decks/mixed.md",
      "/decks/new.md",
    ]);
  });

  it("collects only descendant leaves for folder selection", () => {
    const tree = buildTestTree();
    const selection: ReviewQueueSelection = { type: "folder", path: "folder1" };

    expect(collectDeckPathsFromSelection(selection, tree)).toEqual([
      "/decks/folder1/a.md",
      "/decks/folder1/b.md",
    ]);
  });

  it("collects only the targeted deck for deck selection", () => {
    const tree = buildTestTree();
    const selection: ReviewQueueSelection = { type: "deck", path: "mixed.md" };

    expect(collectDeckPathsFromSelection(selection, tree)).toEqual(["/decks/mixed.md"]);
  });

  it("returns an empty list for non-matching selections", () => {
    const tree = buildTestTree();
    const selection: ReviewQueueSelection = { type: "deck", path: "missing.md" };

    expect(collectDeckPathsFromSelection(selection, tree)).toEqual([]);
  });
});

describe("ReviewQueueService", () => {
  const now = new Date("2025-01-10T00:00:00Z");

  it("builds queue for all selection and soft-skips unreadable/invalid leaves", async () => {
    const tree = buildTestTree();
    const selection: ReviewQueueSelection = { type: "all" };

    const result = await Effect.gen(function* () {
      const service = yield* ReviewQueueService;
      return yield* service.buildQueue(selection, tree, "/decks", now);
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result.totalNew).toBe(4);
    expect(result.totalDue).toBe(4);
    expect(result.items.length).toBe(8);
    expect(result.items.some((item) => item.deckPath === "/decks/broken.md")).toBe(false);
  });

  it("builds queue for deck and folder selections", async () => {
    const tree = buildTestTree();
    const deckSelection: ReviewQueueSelection = { type: "deck", path: "mixed.md" };
    const folderSelection: ReviewQueueSelection = { type: "folder", path: "folder1" };

    const deckResult = await Effect.gen(function* () {
      const service = yield* ReviewQueueService;
      return yield* service.buildQueue(deckSelection, tree, "/decks", now);
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(deckResult.totalNew).toBe(2);
    expect(deckResult.totalDue).toBe(2);
    expect(deckResult.items.length).toBe(4);

    const folderResult = await Effect.gen(function* () {
      const service = yield* ReviewQueueService;
      return yield* service.buildQueue(folderSelection, tree, "/decks", now);
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(folderResult.totalNew).toBe(1);
    expect(folderResult.totalDue).toBe(1);
    expect(folderResult.items.length).toBe(2);
  });
});

describe("ReviewQueueLive defaults", () => {
  it("uses shuffled ordering by default", async () => {
    const tree = buildTestTree();
    const selection: ReviewQueueSelection = { type: "deck", path: "mixed.md" };
    const now = new Date("2025-01-10T00:00:00Z");

    const result = await Effect.gen(function* () {
      const service = yield* ReviewQueueService;
      return yield* service.buildQueue(selection, tree, "/decks", now);
    }).pipe(
      Effect.provide(
        ReviewQueueLive.pipe(Layer.provide(Layer.mergeAll(MockDeckManager, Path.layer))),
      ),
      Effect.withRandom(Random.make("seed")),
      Effect.runPromise,
    );

    expect(result.items.map((item) => item.card.id)).toEqual(["card4", "card1", "card3", "card2"]);
  });
});
