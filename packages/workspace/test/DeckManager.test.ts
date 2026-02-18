import { Path } from "@effect/platform";
import {
  createMetadataWithId,
  numericField,
  type Item,
  type ItemId,
  type ItemType,
} from "@re/core";
import { ContentParseError } from "@re/core";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  CardNotFound,
  DeckManager,
  DeckManagerLive,
  DeckNotFound,
  DeckParseError,
  DeckReadError,
  DeckWriteError,
  ItemValidationError,
} from "../src";
import { createMockFileSystem, type MockFileSystemConfig } from "./mock-file-system";

const makeCard = (id: string, state: 0 | 1 | 2 | 3 = 0): string => `<!--@ ${id} 0 0 ${state} 0-->`;

const singleCardItem = (id: string, content: string): string => `${makeCard(id)}\n${content}`;

const meta = (id: string) => createMetadataWithId(id as ItemId);

const twoSidedType: ItemType<{ front: string; back: string }> = {
  name: "two-sided",
  parse: (content) => {
    const parts = content.split("---\n");
    if (parts.length < 2) {
      return Effect.fail(
        new ContentParseError({ type: "two-sided", message: "Missing separator", raw: content }),
      );
    }
    return Effect.succeed({ front: parts[0]!, back: parts[1]! });
  },
  cards: () => [
    {
      prompt: "",
      reveal: "",
      cardType: "basic",
      responseSchema: {} as any,
      grade: () => Effect.succeed(0 as any),
    },
  ],
};

const twoCardType: ItemType<{ front: string; back: string }> = {
  name: "two-card",
  parse: (content) => {
    const parts = content.split("---\n");
    if (parts.length < 2) {
      return Effect.fail(
        new ContentParseError({ type: "two-card", message: "Missing separator", raw: content }),
      );
    }
    return Effect.succeed({ front: parts[0]!, back: parts[1]! });
  },
  cards: () => [
    {
      prompt: "",
      reveal: "",
      cardType: "forward",
      responseSchema: {} as any,
      grade: () => Effect.succeed(0 as any),
    },
    {
      prompt: "",
      reveal: "",
      cardType: "reverse",
      responseSchema: {} as any,
      grade: () => Effect.succeed(0 as any),
    },
  ],
};

const buildLayer = (config: MockFileSystemConfig) => {
  const mock = createMockFileSystem(config);
  const deps = Layer.merge(mock.layer, Path.layer);
  const layer = Layer.provide(DeckManagerLive, deps);
  return { layer, store: mock.store };
};

const run = <A>(
  config: MockFileSystemConfig,
  fn: (manager: DeckManager) => Effect.Effect<A, any>,
) => {
  const { layer } = buildLayer(config);
  return Effect.gen(function* () {
    const manager = yield* DeckManager;
    return yield* fn(manager);
  }).pipe(Effect.provide(layer), Effect.runPromise);
};

const runEither = <A, E>(
  config: MockFileSystemConfig,
  fn: (manager: DeckManager) => Effect.Effect<A, E>,
) => {
  const { layer, store } = buildLayer(config);
  return {
    promise: Effect.gen(function* () {
      const manager = yield* DeckManager;
      return yield* fn(manager);
    }).pipe(Effect.either, Effect.provide(layer), Effect.runPromise),
    store,
  };
};

const runSuccess = <A>(
  config: MockFileSystemConfig,
  fn: (manager: DeckManager) => Effect.Effect<A, any>,
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

// ---------------------------------------------------------------------------
// readDeck
// ---------------------------------------------------------------------------

describe("DeckManager.readDeck", () => {
  it("returns parsed file for valid deck", async () => {
    const content = `# Title\n${singleCardItem("abc", "Question\n---\nAnswer\n")}`;
    const result = await run(
      { entryTypes: {}, directories: {}, fileContents: { "/deck.md": content } },
      (m) => m.readDeck("/deck.md"),
    );

    expect(result.preamble).toBe("# Title\n");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.cards[0]!.id).toBe("abc");
    expect(result.items[0]!.content).toBe("Question\n---\nAnswer\n");
  });

  it("fails with DeckNotFound when file doesn't exist", async () => {
    const { promise } = runEither({ entryTypes: {}, directories: {} }, (m) =>
      m.readDeck("/missing.md"),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DeckNotFound);
      if (result.left instanceof DeckNotFound) {
        expect(result.left.deckPath).toBe("/missing.md");
      }
    }
  });

  it("fails with DeckReadError on permission denied", async () => {
    const { promise } = runEither(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/blocked.md": "x" },
        readFileErrors: { "/blocked.md": "PermissionDenied" },
      },
      (m) => m.readDeck("/blocked.md"),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DeckReadError);
    }
  });

  it("fails with DeckParseError on malformed metadata", async () => {
    const { promise } = runEither(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/bad.md": "<!--@ bad 0 0 0-->\nContent\n" },
      },
      (m) => m.readDeck("/bad.md"),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DeckParseError);
    }
  });
});

// ---------------------------------------------------------------------------
// updateCardMetadata
// ---------------------------------------------------------------------------

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
    const multiCard = `<!--@ mc-a 0 0 0 0-->\n<!--@ mc-b 0 0 2 0 2025-01-01T00:00:00.000Z-->\nShared\n---\nAnswer\n`;
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
    expect(store["/deck.md"]).toContain("<!--@ mc-b 0 0 2 0 2025-01-01T00:00:00.000Z-->");
  });

  it("fails with CardNotFound for nonexistent ID", async () => {
    const { promise } = runEither(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/deck.md": deckContent },
      },
      (m) => m.updateCardMetadata("/deck.md", "nope", meta("nope")),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(CardNotFound);
      if (result.left instanceof CardNotFound) {
        expect(result.left.cardId).toBe("nope");
      }
    }
  });

  it("fails with DeckNotFound when file doesn't exist", async () => {
    const { promise } = runEither({ entryTypes: {}, directories: {} }, (m) =>
      m.updateCardMetadata("/missing.md", "x", meta("x")),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DeckNotFound);
    }
  });
});

// ---------------------------------------------------------------------------
// replaceItem
// ---------------------------------------------------------------------------

describe("DeckManager.replaceItem", () => {
  const deckContent = `${singleCardItem("item-a", "OldQ\n---\nOldA\n")}${singleCardItem("item-b", "Q2\n---\nA2\n")}`;

  it("replaces item content and metadata", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };
    const newItem: Item = { cards: [meta("item-a")], content: "NewQ\n---\nNewA\n" };
    const { promise, store } = runSuccess(config, (m) =>
      m.replaceItem("/deck.md", "item-a", newItem, twoSidedType),
    );

    await promise;
    expect(store["/deck.md"]).toContain("NewQ\n---\nNewA\n");
    expect(store["/deck.md"]).not.toContain("OldQ");
    expect(store["/deck.md"]).toContain("<!--@ item-b 0 0 0 0-->");
  });

  it("fails with CardNotFound for nonexistent ID", async () => {
    const { promise } = runEither(
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

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(CardNotFound);
    }
  });

  it("fails with ItemValidationError when card count mismatches", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };
    const newItem: Item = { cards: [meta("item-a")], content: "Q\n---\nA\n" };
    const { promise } = runEither(config, (m) =>
      m.replaceItem("/deck.md", "item-a", newItem, twoCardType),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ItemValidationError);
      if (result.left instanceof ItemValidationError) {
        expect(result.left.message).toContain("Card count mismatch");
      }
    }
  });

  it("fails with ItemValidationError when ItemType.parse fails", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": deckContent },
    };
    const newItem: Item = { cards: [meta("item-a")], content: "no separator here" };
    const { promise } = runEither(config, (m) =>
      m.replaceItem("/deck.md", "item-a", newItem, twoSidedType),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ItemValidationError);
      if (result.left instanceof ItemValidationError) {
        expect(result.left.message).toContain("Content parse failed");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// appendItem
// ---------------------------------------------------------------------------

describe("DeckManager.appendItem", () => {
  it("appends to deck with existing items", async () => {
    const existing = singleCardItem("existing", "Q\n---\nA\n");
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": existing },
    };
    const newItem: Item = { cards: [meta("new-card")], content: "NewQ\n---\nNewA\n" };
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
    expect(store["/deck.md"]).toBe("# Title\n<!--@ first 0 0 0 0-->\nQ\n---\nA\n");
  });

  it("ensures newline separator when last content lacks trailing newline", async () => {
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
    expect(written).toContain("Content without newline\n<!--@ b");
  });

  it("ensures newline separator when preamble lacks trailing newline on empty deck", async () => {
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
    expect(store["/deck.md"]).toBe("# No trailing newline\n<!--@ first 0 0 0 0-->\nQ\n---\nA\n");
  });

  it("fails with ItemValidationError on card count mismatch", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": "# Title\n" },
    };
    const newItem: Item = { cards: [meta("a")], content: "Q\n---\nA\n" };
    const { promise } = runEither(config, (m) => m.appendItem("/deck.md", newItem, twoCardType));
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ItemValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// removeItem
// ---------------------------------------------------------------------------

describe("DeckManager.removeItem", () => {
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
    const { promise } = runEither(
      { entryTypes: {}, directories: {}, fileContents: { "/deck.md": content } },
      (m) => m.removeItem("/deck.md", "nope"),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(CardNotFound);
    }
  });
});

// ---------------------------------------------------------------------------
// Atomic write behavior
// ---------------------------------------------------------------------------

describe("DeckManager atomic write", () => {
  it("produces DeckWriteError on write failure", async () => {
    const content = singleCardItem("a", "Q\n");
    const { promise } = runEither(
      {
        entryTypes: {},
        directories: {},
        fileContents: { "/deck.md": content },
        writeFileErrors: { "/deck.md.tmp": "PermissionDenied" },
      },
      (m) => m.updateCardMetadata("/deck.md", "a", meta("a")),
    );
    const result = await promise;

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DeckWriteError);
    }
  });

  it("successful write updates file content (read-back verification)", async () => {
    const content = singleCardItem("a", "Q\n---\nA\n");
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": content },
    };
    const { promise, store } = runSuccess(config, (m) => {
      const updated = { ...meta("a"), stability: numericField(42) };
      return m.updateCardMetadata("/deck.md", "a", updated);
    });

    await promise;

    const readBack = await run(
      { entryTypes: {}, directories: {}, fileContents: { "/deck.md": store["/deck.md"]! } },
      (m) => m.readDeck("/deck.md"),
    );

    expect(readBack.items[0]!.cards[0]!.stability.value).toBe(42);
  });

  it("cleans up temp file on rename failure", async () => {
    const content = singleCardItem("a", "Q\n");
    const config: MockFileSystemConfig = {
      entryTypes: {},
      directories: {},
      fileContents: { "/deck.md": content },
      renameErrors: { "/deck.md.tmp": "PermissionDenied" },
    };
    const { promise, store } = runEither(config, (m) =>
      m.updateCardMetadata("/deck.md", "a", meta("a")),
    );

    await promise;
    expect(store["/deck.md.tmp"]).toBeUndefined();
  });
});
