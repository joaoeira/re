import * as Path from "effect/Path";
import * as FileSystem from "effect/FileSystem";
import {
  adaptItemType,
  createMetadataWithId,
  numericField,
  type Grade,
  type Item,
  ItemIdSchema,
  type ItemType,
} from "../../src/core/index.js";
import { ContentParseError } from "../../src/core/index.js";
import { Effect, Result, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CardNotFound,
  DeckAlreadyExists,
  DeckFileNotFound,
  DeckFileOperationError,
  InvalidDeckPath,
  DeckManager,
  DeckManagerLive,
  DeckNotFound,
  DeckParseError,
  DeckReadError,
  ItemValidationError,
} from "../../src/workspace/index.js";
import {
  createMockFileSystem,
  makeSystemError,
  type MockFileSystemConfig,
} from "./mock-file-system";

const makeCard = (id: string, state: 0 | 1 | 2 | 3 = 0): string => `<!--@ ${id} 0 0 ${state} 0-->`;

const singleCardItem = (id: string, content: string): string => `${makeCard(id)}\n${content}`;

const meta = (id: string) => createMetadataWithId(Schema.decodeSync(ItemIdSchema)(id));

const twoSidedType = adaptItemType({
  name: "two-sided",
  parse: (content) => {
    const parts = content.split("---\n");

    if (parts.length < 2) {
      return Effect.fail(
        new ContentParseError({
          type: "two-sided",
          message: "Missing separator",
          raw: content,
        }),
      );
    }

    return Effect.succeed({ front: parts[0]!, back: parts[1]! });
  },
  cards: () => [
    {
      prompt: "",
      reveal: "",
      cardType: "basic",
      key: "basic",
      responseSchema: Schema.Unknown,
      grade: () => Effect.succeed<Grade>(0),
    },
  ],
} satisfies ItemType<{ front: string; back: string }>);

const twoCardType = adaptItemType({
  name: "two-card",
  parse: (content) => {
    const parts = content.split("---\n");

    if (parts.length < 2) {
      return Effect.fail(
        new ContentParseError({
          type: "two-card",
          message: "Missing separator",
          raw: content,
        }),
      );
    }

    return Effect.succeed({ front: parts[0]!, back: parts[1]! });
  },
  cards: () => [
    {
      prompt: "",
      reveal: "",
      cardType: "forward",
      key: "forward",
      responseSchema: Schema.Unknown,
      grade: () => Effect.succeed<Grade>(0),
    },
    {
      prompt: "",
      reveal: "",
      cardType: "reverse",
      key: "reverse",
      responseSchema: Schema.Unknown,
      grade: () => Effect.succeed<Grade>(0),
    },
  ],
} satisfies ItemType<{ front: string; back: string }>);

const buildLayer = (config: MockFileSystemConfig) => {
  const mock = createMockFileSystem(config);
  const deps = Layer.merge(mock.layer, Path.layer);
  const layer = Layer.provide(DeckManagerLive, deps);

  return { layer, store: mock.store };
};

const run = <A>(
  config: MockFileSystemConfig,
  fn: (manager: DeckManager) => Effect.Effect<A, unknown>,
) => {
  const { layer } = buildLayer(config);

  return Effect.gen(function* () {
    const manager = yield* DeckManager;

    return yield* fn(manager);
  }).pipe(Effect.provide(layer), Effect.runPromise);
};

const runResult = <A, E>(
  config: MockFileSystemConfig,
  fn: (manager: DeckManager) => Effect.Effect<A, E>,
) => {
  const { layer, store } = buildLayer(config);

  return {
    promise: Effect.gen(function* () {
      const manager = yield* DeckManager;

      return yield* fn(manager);
    }).pipe(Effect.result, Effect.provide(layer), Effect.runPromise),
    store,
  };
};

const runSuccess = <A>(
  config: MockFileSystemConfig,
  fn: (manager: DeckManager) => Effect.Effect<A, unknown>,
) => {
  const { layer, store } = buildLayer(config);

  return {
    promise: Effect.gen(function* () {
      const manager = yield* DeckManager;

      return yield* fn(manager);
    }).pipe(Effect.provide(layer), Effect.runPromise),
    store,
  };
};

describe("DeckManager.readDeck", () => {
  it("returns parsed file for valid deck", async () => {
    const content = `# Title\n${singleCardItem("abc", "Question\n---\nAnswer\n")}`;

    const result = await run(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/deck.md": content },
      },
      (m) => m.readDeck("/deck.md"),
    );

    expect(result.preamble).toBe("# Title\n");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.cards[0]!.id).toBe("abc");
    expect(result.items[0]!.content).toBe("Question\n---\nAnswer\n");
  });

  it("fails with DeckNotFound when file doesn't exist", async () => {
    const { promise } = runResult({ entryTypes: {}, directories: {} }, (m) =>
      m.readDeck("/missing.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckNotFound);

      if (result.failure instanceof DeckNotFound) {
        expect(result.failure.deckPath).toBe("/missing.md");
      }
    }
  });

  it("fails with DeckReadError on permission denied", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/blocked.md": "x" },
        readFileErrors: { "/blocked.md": "PermissionDenied" },
      },
      (m) => m.readDeck("/blocked.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckReadError);
    }
  });

  it("fails with DeckParseError on malformed metadata", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/bad.md": "<!--@ bad 0 0 0-->\nContent\n" },
      },
      (m) => m.readDeck("/bad.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckParseError);
    }
  });
});

describe("DeckManager.updateCardMetadata", () => {
  const deckContent = `# Preamble\n${singleCardItem("card-a", "Q1\n---\nA1\n")}${singleCardItem("card-b", "Q2\n---\nA2\n")}`;

  it("updates a card's metadata by ID", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };

    const { promise, store } = runSuccess(config, (m) => {
      const updated = {
        ...meta("card-a"),
        stability: numericField(5),
        difficulty: numericField(3),
      };

      return m.updateCardMetadata("/deck.md", "card-a", updated);
    });

    await promise;
    expect(store["/deck.md"]).toContain("<!--@ card-a 5 3 0 0-->");
    expect(store["/deck.md"]).toContain("<!--@ card-b 0 0 0 0-->");
  });

  it("serializes due when present on updated metadata", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };

    const { promise, store } = runSuccess(config, (m) => {
      const updated = {
        ...meta("card-a"),
        state: 2 as const,
        lastReview: new Date("2025-01-01T00:00:00.000Z"),
        due: new Date("2025-01-08T00:00:00.000Z"),
      };

      return m.updateCardMetadata("/deck.md", "card-a", updated);
    });

    await promise;
    expect(store["/deck.md"]).toContain(
      "<!--@ card-a 0 0 2 0 2025-01-01T00:00:00.000Z 2025-01-08T00:00:00.000Z-->",
    );
  });

  it("preserves preamble and content byte-perfect", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };

    const { promise, store } = runSuccess(config, (m) =>
      m.updateCardMetadata("/deck.md", "card-a", meta("card-a")),
    );

    await promise;
    expect(store["/deck.md"]).toContain("# Preamble\n");
    expect(store["/deck.md"]).toContain("Q1\n---\nA1\n");
    expect(store["/deck.md"]).toContain("Q2\n---\nA2\n");
  });

  it("preserves other cards in the same item", async () => {
    const multiCard = `<!--@ mc-a 0 0 0 0-->\n<!--@ mc-b 0 0 2 0 2025-01-01T00:00:00.000Z 2025-01-01T00:00:00.000Z-->\nShared\n---\nAnswer\n`;

    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": multiCard },
    };

    const { promise, store } = runSuccess(config, (m) => {
      const updated = { ...meta("mc-a"), stability: numericField(9) };

      return m.updateCardMetadata("/deck.md", "mc-a", updated);
    });

    await promise;
    expect(store["/deck.md"]).toContain("<!--@ mc-a 9 0 0 0-->");
    expect(store["/deck.md"]).toContain(
      "<!--@ mc-b 0 0 2 0 2025-01-01T00:00:00.000Z 2025-01-01T00:00:00.000Z-->",
    );
  });

  it("fails with CardNotFound for nonexistent ID", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/deck.md": deckContent },
      },
      (m) => m.updateCardMetadata("/deck.md", "nope", meta("nope")),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(CardNotFound);

      if (result.failure instanceof CardNotFound) {
        expect(result.failure.cardId).toBe("nope");
      }
    }
  });

  it("fails with DeckNotFound when file doesn't exist", async () => {
    const { promise } = runResult({ entryTypes: {}, directories: {} }, (m) =>
      m.updateCardMetadata("/missing.md", "x", meta("x")),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckNotFound);
    }
  });
});

describe("DeckManager.modifyItem", () => {
  it("rejects duplicate generated keys without changing the saved deck", async () => {
    const original = singleCardItem("existing", "Question\n---\nAnswer\n");

    const duplicateKeyType = {
      ...twoCardType,
      parseCards: (content: string) =>
        twoCardType
          .parseCards(content)
          .pipe(Effect.map((cards) => cards.map((card) => ({ ...card, key: "shared" })))),
    };

    const { promise, store } = runResult(
      { entryTypes: {}, directories: {}, fileContents: { "/deck.md": original } },
      (manager) =>
        manager.modifyItem(
          "/deck.md",
          "existing",
          () =>
            Effect.succeed({
              content: "Updated question\n---\nUpdated answer",
              cards: [meta("first"), meta("second")],
            }),
          duplicateKeyType,
        ),
    );

    expect(await promise).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ItemValidationError", message: "Duplicate generated card key: shared" },
    });
    expect(store["/deck.md"]).toBe(original);
  });
});

describe("DeckManager.replaceItem", () => {
  const deckContent = `${singleCardItem("item-a", "OldQ\n---\nOldA\n")}${singleCardItem("item-b", "Q2\n---\nA2\n")}`;

  it("replaces item content and metadata", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };

    const newItem: Item = {
      cards: [meta("item-a")],
      content: "NewQ\n---\nNewA",
    };

    const { promise, store } = runSuccess(config, (m) =>
      m.replaceItem("/deck.md", "item-a", newItem, twoSidedType),
    );

    await promise;
    expect(store["/deck.md"]).toContain("NewQ\n---\nNewA\n<!--@ item-b 0 0 0 0-->");
    expect(store["/deck.md"]).not.toContain("OldQ");
    expect(store["/deck.md"]).toContain("<!--@ item-b 0 0 0 0-->");
  });

  it("fails with CardNotFound for nonexistent ID", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/deck.md": deckContent },
      },
      (m) =>
        m.replaceItem(
          "/deck.md",
          "nope",
          { cards: [meta("nope")], content: "x\n---\ny\n" },
          twoSidedType,
        ),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(CardNotFound);
    }
  });

  it("fails with ItemValidationError when card count mismatches", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };

    const newItem: Item = { cards: [meta("item-a")], content: "Q\n---\nA\n" };

    const { promise } = runResult(config, (m) =>
      m.replaceItem("/deck.md", "item-a", newItem, twoCardType),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ItemValidationError);

      if (result.failure instanceof ItemValidationError) {
        expect(result.failure.message).toContain("Card count mismatch");
      }
    }
  });

  it("fails with ItemValidationError when ItemType.parse fails", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };

    const newItem: Item = {
      cards: [meta("item-a")],
      content: "no separator here",
    };

    const { promise } = runResult(config, (m) =>
      m.replaceItem("/deck.md", "item-a", newItem, twoSidedType),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ItemValidationError);

      if (result.failure instanceof ItemValidationError) {
        expect(result.failure.message).toContain("Content parse failed");
      }
    }
  });
});

describe("DeckManager.appendItem", () => {
  it("appends to deck with existing items", async () => {
    const existing = singleCardItem("existing", "Q\n---\nA\n");

    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": existing },
    };

    const newItem: Item = {
      cards: [meta("new-card")],
      content: "NewQ\n---\nNewA\n",
    };

    const { promise, store } = runSuccess(config, (m) =>
      m.appendItem("/deck.md", newItem, twoSidedType),
    );

    await promise;
    expect(store["/deck.md"]).toContain("<!--@ existing 0 0 0 0-->");
    expect(store["/deck.md"]).toContain("<!--@ new-card 0 0 0 0-->");
    expect(store["/deck.md"]).toContain("NewQ\n---\nNewA\n");
  });

  it("appends to empty deck (preamble-only)", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": "# Title\n" },
    };

    const newItem: Item = { cards: [meta("first")], content: "Q\n---\nA\n" };

    const { promise, store } = runSuccess(config, (m) =>
      m.appendItem("/deck.md", newItem, twoSidedType),
    );

    await promise;
    expect(store["/deck.md"]).toBe("# Title\n\n<!--@ first 0 0 0 0-->\nQ\n---\nA\n");
  });

  it("ensures blank line separator when last content lacks trailing newline", async () => {
    const existing = `${makeCard("a")}\nContent without newline`;

    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": existing },
    };

    const newItem: Item = { cards: [meta("b")], content: "Q\n---\nA\n" };

    const { promise, store } = runSuccess(config, (m) =>
      m.appendItem("/deck.md", newItem, twoSidedType),
    );

    await promise;
    const written = store["/deck.md"]!;
    expect(written).toContain("Content without newline\n\n<!--@ b");
  });

  it("ensures blank line separator when preamble lacks trailing newline on empty deck", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": "# No trailing newline" },
    };

    const newItem: Item = { cards: [meta("first")], content: "Q\n---\nA\n" };

    const { promise, store } = runSuccess(config, (m) =>
      m.appendItem("/deck.md", newItem, twoSidedType),
    );

    await promise;
    expect(store["/deck.md"]).toBe("# No trailing newline\n\n<!--@ first 0 0 0 0-->\nQ\n---\nA\n");
  });

  it("fails with ItemValidationError on card count mismatch", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": "# Title\n" },
    };

    const newItem: Item = { cards: [meta("a")], content: "Q\n---\nA\n" };
    const { promise } = runResult(config, (m) => m.appendItem("/deck.md", newItem, twoCardType));
    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ItemValidationError);
    }
  });
});

describe("DeckManager.removeItem", () => {
  it("restores a removed item at its original position", async () => {
    const content = `${singleCardItem("a", "QA\n")}${singleCardItem("b", "QB\n")}${singleCardItem("c", "QC\n")}`;

    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": content },
    };

    const { promise, store } = runSuccess(config, (manager) =>
      Effect.gen(function* () {
        const removed = yield* manager.removeItem("/deck.md", "b");
        yield* manager.restoreItem("/deck.md", removed);

        return removed;
      }),
    );

    const removed = await promise;

    expect(removed.itemIndex).toBe(1);
    expect(removed.item.cards.map((card) => card.id)).toEqual(["b"]);
    expect(store["/deck.md"]).toBe(content);
  });

  it("removes item from middle, preserves surrounding items", async () => {
    const content = `${singleCardItem("a", "QA\n")}${singleCardItem("b", "QB\n")}${singleCardItem("c", "QC\n")}`;

    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": content },
    };

    const { promise, store } = runSuccess(config, (m) => m.removeItem("/deck.md", "b"));

    await promise;
    const written = store["/deck.md"]!;
    expect(written).toContain("<!--@ a 0 0 0 0-->");
    expect(written).toContain("<!--@ c 0 0 0 0-->");
    expect(written).not.toContain("<!--@ b");
    expect(written).not.toContain("QB");
  });

  it("removes last item, leaves only preamble", async () => {
    const content = `# Title\n${singleCardItem("only", "Q\n---\nA\n")}`;

    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": content },
    };

    const { promise, store } = runSuccess(config, (m) => m.removeItem("/deck.md", "only"));

    await promise;
    expect(store["/deck.md"]).toBe("# Title\n");
  });

  it("fails with CardNotFound for nonexistent ID", async () => {
    const content = singleCardItem("a", "Q\n");

    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/deck.md": content },
      },
      (m) => m.removeItem("/deck.md", "nope"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(CardNotFound);
    }
  });
});

describe("DeckManager.createDeck", () => {
  it("creates a new deck file when parent exists", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {
        "/workspace": "Directory",
        "/workspace/books": "Directory",
      },
      directories: {},
    };

    const { promise, store } = runSuccess(config, (m) =>
      m.createDeck("/workspace/books/book1.md", {
        initialContent: "# Book 1\n",
      }),
    );

    await promise;
    expect(store["/workspace/books/book1.md"]).toBe("# Book 1\n");
  });

  it("creates a nested deck when createParents is enabled", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
    };

    const { promise, store } = runSuccess(config, (m) =>
      m.createDeck("/workspace/books/book1.md", {
        createParents: true,
        initialContent: "",
      }),
    );

    await promise;
    expect(store["/workspace/books/book1.md"]).toBe("");
  });

  it("fails with DeckFileOperationError when parent directory is missing by default", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
      },
      (m) => m.createDeck("/workspace/books/book1.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckFileOperationError);

      if (result.failure instanceof DeckFileOperationError) {
        expect(result.failure.operation).toBe("create");
      }
    }
  });

  it("fails with DeckAlreadyExists when target deck already exists", async () => {
    const { promise } = runResult(
      {
        entryTypes: {
          "/workspace": "Directory",
          "/workspace/books": "Directory",
        },
        directories: {},
        fileContents: {
          "/workspace/books/book1.md": "existing",
        },
      },
      (m) => m.createDeck("/workspace/books/book1.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckAlreadyExists);
    }
  });

  it("maps writeFile wx AlreadyExists to DeckAlreadyExists", async () => {
    const { promise } = runResult(
      {
        entryTypes: {
          "/workspace": "Directory",
          "/workspace/books": "Directory",
        },
        directories: {},
        writeFileErrors: {
          "/workspace/books/book1.md": "AlreadyExists",
        },
      },
      (m) => m.createDeck("/workspace/books/book1.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckAlreadyExists);
    }
  });

  it("fails with InvalidDeckPath for relative paths", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
      },
      (m) => m.createDeck("books/book1.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InvalidDeckPath);

      if (result.failure instanceof InvalidDeckPath) {
        expect(result.failure.reason).toBe("absolute_path_required");
      }
    }
  });

  it("fails with InvalidDeckPath for paths containing NUL bytes", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
      },
      (m) => m.createDeck("/workspace/books/\0book1.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(InvalidDeckPath);

      if (result.failure instanceof InvalidDeckPath) {
        expect(result.failure.reason).toBe("nul_byte_not_allowed");
      }
    }
  });
});

describe("DeckManager.deleteDeck", () => {
  it("deletes an existing deck file", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {
        "/workspace/books/book1.md": "File",
      },
      directories: {},
      fileContents: {
        "/workspace/books/book1.md": "# deck",
      },
    };

    const { promise, store } = runSuccess(config, (m) => m.deleteDeck("/workspace/books/book1.md"));

    await promise;
    expect(store["/workspace/books/book1.md"]).toBeUndefined();
  });

  it("fails with DeckFileNotFound when deck does not exist", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
      },
      (m) => m.deleteDeck("/workspace/books/missing.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckFileNotFound);
    }
  });

  it("maps remove NotFound to DeckFileNotFound", async () => {
    const { promise } = runResult(
      {
        entryTypes: {
          "/workspace/books/book1.md": "File",
        },
        directories: {},
        fileContents: {
          "/workspace/books/book1.md": "# deck",
        },
        removeErrors: {
          "/workspace/books/book1.md": "NotFound",
        },
      },
      (m) => m.deleteDeck("/workspace/books/book1.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckFileNotFound);
    }
  });

  it("fails with DeckFileOperationError when target is not a file", async () => {
    const { promise } = runResult(
      {
        entryTypes: {
          "/workspace/books.md": "Directory",
        },
        directories: {},
      },
      (m) => m.deleteDeck("/workspace/books.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckFileOperationError);

      if (result.failure instanceof DeckFileOperationError) {
        expect(result.failure.operation).toBe("delete");
      }
    }
  });
});

describe("DeckManager.renameDeck", () => {
  it("renames a deck file", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {
        "/workspace/books/book1.md": "File",
        "/workspace/books": "Directory",
      },
      directories: {},
      fileContents: {
        "/workspace/books/book1.md": "# old",
      },
    };

    const { promise, store } = runSuccess(config, (m) =>
      m.renameDeck("/workspace/books/book1.md", "/workspace/books/book-01.md"),
    );

    await promise;
    expect(store["/workspace/books/book1.md"]).toBeUndefined();
    expect(store["/workspace/books/book-01.md"]).toBe("# old");
  });

  it("fails with DeckAlreadyExists when destination exists", async () => {
    const { promise } = runResult(
      {
        entryTypes: {
          "/workspace/books/book1.md": "File",
          "/workspace/books/book-01.md": "File",
          "/workspace/books": "Directory",
        },
        directories: {},
        fileContents: {
          "/workspace/books/book1.md": "# old",
          "/workspace/books/book-01.md": "# existing",
        },
      },
      (m) => m.renameDeck("/workspace/books/book1.md", "/workspace/books/book-01.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckAlreadyExists);
    }
  });

  it("fails with DeckFileNotFound when source missing and source equals destination", async () => {
    const { promise } = runResult(
      {
        entryTypes: {},
        directories: {},
      },
      (m) => m.renameDeck("/workspace/books/missing.md", "/workspace/books/missing.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckFileNotFound);
    }
  });

  it("creates destination parent when createParents is enabled", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {
        "/workspace/books/book1.md": "File",
      },
      directories: {},
      fileContents: {
        "/workspace/books/book1.md": "# old",
      },
    };

    const { promise, store } = runSuccess(config, (m) =>
      m.renameDeck("/workspace/books/book1.md", "/workspace/archive/book-01.md", {
        createParents: true,
      }),
    );

    await promise;
    expect(store["/workspace/archive/book-01.md"]).toBe("# old");
  });

  it("maps rename AlreadyExists to DeckAlreadyExists", async () => {
    const { promise } = runResult(
      {
        entryTypes: {
          "/workspace/books/book1.md": "File",
          "/workspace/books": "Directory",
        },
        directories: {},
        fileContents: {
          "/workspace/books/book1.md": "# old",
        },
        renameErrors: {
          "/workspace/books/book1.md": "AlreadyExists",
        },
      },
      (m) => m.renameDeck("/workspace/books/book1.md", "/workspace/books/book-01.md"),
    );

    const result = await promise;

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DeckAlreadyExists);
    }
  });

  it("maps rename NotFound to DeckFileNotFound when source disappears mid-rename", async () => {
    const mock = createMockFileSystem({
      entryTypes: {
        "/workspace/books/book1.md": "File",
        "/workspace/books": "Directory",
      },
      directories: {},
      fileContents: {
        "/workspace/books/book1.md": "# old",
      },
    });

    const result = await Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const manager = yield* DeckManager.pipe(
        Effect.provide(
          DeckManagerLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(FileSystem.FileSystem, {
                  ...fs,
                  rename: (from) =>
                    fs
                      .remove(from)
                      .pipe(
                        Effect.andThen(Effect.fail(makeSystemError("NotFound", "rename", from))),
                      ),
                }),
                Path.layer,
              ),
            ),
          ),
        ),
      );

      return yield* manager
        .renameDeck("/workspace/books/book1.md", "/workspace/books/book-01.md")
        .pipe(Effect.result);
    }).pipe(Effect.provide(mock.layer), Effect.runPromise);

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "DeckFileNotFound", deckPath: "/workspace/books/book1.md" },
    });
    expect(mock.store["/workspace/books/book1.md"]).toBeUndefined();
  });

  it("preserves the source and reports an operation error when rename cannot find another path", async () => {
    const { promise, store } = runResult(
      {
        entryTypes: { "/workspace/books/book1.md": "File", "/workspace/books": "Directory" },
        directories: {},
        fileContents: { "/workspace/books/book1.md": "# old" },
        renameErrors: { "/workspace/books/book1.md": "NotFound" },
      },
      (manager) => manager.renameDeck("/workspace/books/book1.md", "/workspace/books/book-01.md"),
    );

    expect(await promise).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DeckFileOperationError",
        operation: "rename",
        fromPath: "/workspace/books/book1.md",
        toPath: "/workspace/books/book-01.md",
        message: expect.stringContaining("NotFound"),
      },
    });
    expect(store["/workspace/books/book1.md"]).toBe("# old");
    expect(store["/workspace/books/book-01.md"]).toBeUndefined();
  });
});
