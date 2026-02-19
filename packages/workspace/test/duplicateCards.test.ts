import { Path } from "@effect/platform";
import { Effect, Either, Layer } from "effect";
import { numericField, type ItemId, type ParsedFile } from "@re/core";
import { describe, expect, it } from "vitest";

import {
  DeckManagerLive,
  WorkspaceRootNotFound,
  extractCardLocations,
  findDuplicates,
  findWorkspaceDuplicates,
  type CardLocation,
} from "../src";
import { createMockFileSystemLayer, type MockFileSystemConfig } from "./mock-file-system";

const makeCard = (id: string) => ({
  id: id as ItemId,
  stability: numericField(0),
  difficulty: numericField(0),
  state: 0 as const,
  learningSteps: 0,
  lastReview: null,
  due: null,
});

const makeDeck = (
  path: string,
  cards: { cardIds: string[] }[],
): { path: string; file: ParsedFile } => ({
  path,
  file: {
    preamble: "",
    items: cards.map(({ cardIds }) => ({
      cards: cardIds.map(makeCard),
      content: "Q\n---\nA",
    })),
  },
});

const runFindDuplicates = (
  rootPath: string,
  config: MockFileSystemConfig,
  options?: Parameters<typeof findWorkspaceDuplicates>[1],
) => {
  const fileSystemLayer = createMockFileSystemLayer(config);
  const deckManagerLayer = DeckManagerLive.pipe(
    Layer.provide(Layer.merge(fileSystemLayer, Path.layer)),
  );

  return findWorkspaceDuplicates(rootPath, options).pipe(
    Effect.provide(Layer.mergeAll(deckManagerLayer, fileSystemLayer, Path.layer)),
    Effect.runPromise,
  );
};

const runFindDuplicatesEither = (
  rootPath: string,
  config: MockFileSystemConfig,
  options?: Parameters<typeof findWorkspaceDuplicates>[1],
) => {
  const fileSystemLayer = createMockFileSystemLayer(config);
  const deckManagerLayer = DeckManagerLive.pipe(
    Layer.provide(Layer.merge(fileSystemLayer, Path.layer)),
  );

  return findWorkspaceDuplicates(rootPath, options).pipe(
    Effect.either,
    Effect.provide(Layer.mergeAll(deckManagerLayer, fileSystemLayer, Path.layer)),
    Effect.runPromise,
  );
};

describe("duplicateCards helpers", () => {
  describe("extractCardLocations", () => {
    it("extracts all card locations from a single deck", () => {
      const decks = [makeDeck("/deck1.md", [{ cardIds: ["a", "b"] }])];

      const result = extractCardLocations(decks);

      expect(result).toEqual([
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "a" },
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 1, id: "b" },
      ]);
    });

    it("extracts locations from multiple items and decks", () => {
      const decks = [
        makeDeck("/deck1.md", [{ cardIds: ["a"] }, { cardIds: ["b"] }]),
        makeDeck("/deck2.md", [{ cardIds: ["c"] }]),
      ];

      const result = extractCardLocations(decks);

      expect(result).toEqual([
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "a" },
        { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "b" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "c" },
      ]);
    });

    it("returns empty array for empty input", () => {
      expect(extractCardLocations([])).toEqual([]);
    });
  });

  describe("findDuplicates", () => {
    it("finds duplicates across files and within a file", () => {
      const locations: CardLocation[] = [
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "dup" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "dup" },
        { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "self" },
        { filePath: "/deck1.md", itemIndex: 2, cardIndex: 0, id: "self" },
      ];

      expect(findDuplicates(locations)).toEqual({
        dup: [
          { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "dup" },
          { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "dup" },
        ],
        self: [
          { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "self" },
          { filePath: "/deck1.md", itemIndex: 2, cardIndex: 0, id: "self" },
        ],
      });
    });

    it("returns empty record when no duplicates", () => {
      expect(
        findDuplicates([
          { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "a" },
          { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "b" },
          { filePath: "/deck3.md", itemIndex: 0, cardIndex: 0, id: "c" },
        ]),
      ).toEqual({});
    });

    it("handles prototype-like IDs safely", () => {
      const result = findDuplicates([
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "__proto__" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "__proto__" },
        { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "toString" },
        { filePath: "/deck2.md", itemIndex: 1, cardIndex: 0, id: "toString" },
      ]);

      expect(result["__proto__"]).toHaveLength(2);
      expect(result.toString).toHaveLength(2);
      expect(Object.hasOwn(result, "__proto__")).toBe(true);
      expect(Object.hasOwn(result, "toString")).toBe(true);
    });
  });
});

describe("findWorkspaceDuplicates", () => {
  it("finds duplicates across discovered decks", async () => {
    const result = await runFindDuplicates("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/a.md": "File",
        "/root/b.md": "File",
      },
      directories: {
        "/root": ["a.md", "b.md"],
      },
      fileContents: {
        "/root/a.md": `<!--@ dup 0 0 0 0-->
Q
---
A

<!--@ unique-a 0 0 0 0-->
Q
---
A
`,
        "/root/b.md": `<!--@ dup 0 0 0 0-->
Q
---
A
`,
      },
    });

    expect(result.rootPath).toBe("/root");
    expect(result.scannedDecks).toBe(2);
    expect(result.loadedDecks).toBe(2);
    expect(result.skippedDecks).toBe(0);
    expect(Object.keys(result.duplicates)).toEqual(["dup"]);
    expect(result.duplicates["dup"]).toHaveLength(2);
  });

  it("soft-skips unreadable and parse-failing decks while keeping valid duplicates", async () => {
    const result = await runFindDuplicates("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/a.md": "File",
        "/root/b.md": "File",
        "/root/broken.md": "File",
        "/root/blocked.md": "File",
      },
      directories: {
        "/root": ["a.md", "b.md", "broken.md", "blocked.md"],
      },
      fileContents: {
        "/root/a.md": `<!--@ dup 0 0 0 0-->
Q
---
A
`,
        "/root/b.md": `<!--@ dup 0 0 0 0-->
Q
---
A
`,
        "/root/broken.md": "<!--@ bad metadata-->",
      },
      readFileErrors: {
        "/root/blocked.md": "PermissionDenied",
      },
    });

    expect(result.scannedDecks).toBe(4);
    expect(result.loadedDecks).toBe(2);
    expect(result.skippedDecks).toBe(2);
    expect(Object.keys(result.duplicates)).toEqual(["dup"]);
    expect(result.duplicates["dup"]).toHaveLength(2);
  });

  it("propagates root-level scan errors", async () => {
    const result = await runFindDuplicatesEither("/missing", {
      entryTypes: {},
      directories: {},
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(WorkspaceRootNotFound);
    }
  });

  it("returns zero counts when no markdown decks are discovered", async () => {
    const result = await runFindDuplicates("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/subdir": "Directory",
        "/root/readme.txt": "File",
      },
      directories: {
        "/root": ["subdir", "readme.txt"],
        "/root/subdir": [],
      },
      fileContents: {
        "/root/readme.txt": "not a deck",
      },
    });

    expect(result.rootPath).toBe("/root");
    expect(result.scannedDecks).toBe(0);
    expect(result.loadedDecks).toBe(0);
    expect(result.skippedDecks).toBe(0);
    expect(result.duplicates).toEqual({});
  });
});
