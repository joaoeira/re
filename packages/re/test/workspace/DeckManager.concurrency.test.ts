import * as TestClock from "effect/testing/TestClock";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import {
  createMetadataWithId,
  numericField,
  serializeFile,
  type EvaluableItemType,
  type Item,
  ItemIdSchema,
} from "../../src/core/index.js";
import { Data, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect";

import { DeckManager, DeckManagerLive } from "../../src/workspace/index.js";
import { createMockFileSystem, makeSystemError } from "./mock-file-system";

const item = (id: string, content = `${id}\n`): Item => ({
  cards: [createMetadataWithId(Schema.decodeSync(ItemIdSchema)(id))],
  content,
});

const itemType: EvaluableItemType = {
  name: "single-card",
  parseCards: () =>
    Effect.succeed([
      {
        prompt: "",
        reveal: "",
        cardType: "basic",
        key: "main",
        evaluate: () => Effect.succeed(0 as const),
      },
    ]),
};

const makeManager = (fs: FileSystem.FileSystem) =>
  DeckManager.pipe(
    Effect.provide(
      DeckManagerLive.pipe(
        Layer.provide(Layer.merge(Layer.succeed(FileSystem.FileSystem, fs), Path.layer)),
      ),
    ),
  );

const mockFs = (items: readonly Item[]) => {
  const content = serializeFile({ preamble: "", items });

  return FileSystem.FileSystem.pipe(
    Effect.provide(
      createMockFileSystem({
        entryTypes: { "/": "Directory", "/deck.md": "File", "/other.md": "File" },
        directories: {},
        fileContents: { "/deck.md": content, "/other.md": content },
      }).layer,
    ),
  );
};

const pauseValidation = Effect.gen(function* () {
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();

  const type: EvaluableItemType = {
    ...itemType,
    parseCards: (content) =>
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(itemType.parseCards(content)),
      ),
  };

  return { entered, release, type };
});

describe("DeckManager concurrent mutations", () => {
  it.live("computes metadata from the latest saved card while serializing with item edits", () =>
    Effect.gen(function* () {
      const manager = yield* makeManager(yield* mockFs([item("a"), item("b")]));
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();

      const increment = (pause: boolean) =>
        manager.modifyCardMetadata("/deck.md", "a", ({ card }) =>
          Effect.gen(function* () {
            if (pause) {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }

            return {
              metadata: { ...card, stability: numericField(card.stability.value + 1) },
              result: card.stability.value,
            };
          }),
        );

      const first = yield* increment(true).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const second = yield* increment(false).pipe(Effect.forkScoped);

      const edit = yield* manager
        .modifyItem(
          "/deck.md",
          "a",
          (current) => Effect.succeed({ ...current, content: "Edited\n" }),
          itemType,
        )
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(first)).toBe(0);
      expect(yield* Fiber.join(second)).toBe(1);
      yield* Fiber.join(edit);

      const saved = yield* manager.readDeck("/deck.md");
      expect(saved.items[0]).toMatchObject({
        content: "Edited\n",
        cards: [{ id: "a", stability: { value: 2 } }],
      });
      expect(saved.items[1]).toEqual(item("b"));
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.live("preserves independent changes made concurrently through every edit operation", () =>
    Effect.gen(function* () {
      const fs = yield* mockFs([
        item("reviewed"),
        item("edited"),
        item("deleted"),
        item("restored"),
      ]);

      const manager = yield* makeManager({
        ...fs,
        // Capture the old contents before yielding, as an asynchronous read can do.
        readFileString: (path) => fs.readFileString(path).pipe(Effect.tap(() => Effect.yieldNow)),
      });

      const removed = yield* manager.removeItem("/deck.md", "restored");
      yield* Effect.all(
        [
          manager.updateCardMetadata("/folder/../deck.md", "reviewed", {
            ...item("reviewed").cards[0]!,
            stability: numericField(42),
          }),
          manager.replaceItem("/deck.md", "edited", item("edited", "New content\n"), itemType),
          manager.appendItem("/deck.md", item("appended"), itemType),
          manager.removeItem("/deck.md", "deleted"),
          manager.restoreItem("/deck.md", removed),
        ],
        { concurrency: "unbounded" },
      );

      const saved = yield* manager.readDeck("/deck.md");
      expect(saved.items.map((entry) => entry.cards[0]!.id).sort()).toEqual([
        "appended",
        "edited",
        "restored",
        "reviewed",
      ]);
      expect(
        saved.items.find((entry) => entry.cards[0]!.id === "reviewed")!.cards[0]!.stability.value,
      ).toBe(42);
      expect(saved.items.find((entry) => entry.cards[0]!.id === "edited")!.content.trim()).toBe(
        "New content",
      );
    }),
  );

  it.live("lets another deck save while an edit is waiting for validation", () =>
    Effect.gen(function* () {
      const manager = yield* makeManager(yield* mockFs([item("a")]));
      const pause = yield* pauseValidation;

      const edit = yield* manager
        .replaceItem("/deck.md", "a", item("a"), pause.type)
        .pipe(Effect.forkScoped);

      yield* Deferred.await(pause.entered);

      yield* manager.updateCardMetadata("/other.md", "a", {
        ...item("a").cards[0]!,
        stability: numericField(42),
      });
      expect((yield* manager.readDeck("/other.md")).items[0]!.cards[0]!.stability.value).toBe(42);
      yield* Deferred.succeed(pause.release, undefined);
      yield* Fiber.join(edit);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("cancels a waiting edit without saving it or blocking later edits", () =>
    Effect.gen(function* () {
      const manager = yield* makeManager(yield* mockFs([item("a"), item("b")]));
      const pause = yield* pauseValidation;

      const edit = yield* manager
        .replaceItem("/deck.md", "a", item("a", "Saved\n"), pause.type)
        .pipe(Effect.forkScoped);

      yield* Deferred.await(pause.entered);
      const cancelled = yield* manager.removeItem("/deck.md", "b").pipe(Effect.forkScoped);
      yield* TestClock.adjust(0);
      yield* Fiber.interrupt(cancelled);
      expect(Exit.hasInterrupts(yield* Fiber.await(cancelled))).toBe(true);
      yield* Deferred.succeed(pause.release, undefined);
      yield* Fiber.join(edit);
      yield* manager.appendItem("/deck.md", item("c"), itemType);
      const saved = yield* manager.readDeck("/deck.md");
      expect(saved.items.map((entry) => entry.cards[0]!.id)).toEqual(["a", "b", "c"]);
      expect(saved.items[0]!.content.trim()).toBe("Saved");
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.live("releases a partially acquired rename lock set when the rename is cancelled", () =>
    Effect.gen(function* () {
      const fs = yield* mockFs([item("a")]);
      yield* fs.rename("/deck.md", "/a.md");
      yield* fs.rename("/other.md", "/z.md");
      const manager = yield* makeManager(fs);
      const holdingDestination = yield* Deferred.make<void>();
      const releaseDestination = yield* Deferred.make<void>();

      const holder = yield* manager
        .modifyCardMetadata("/z.md", "a", ({ card }) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(holdingDestination, undefined);
            yield* Deferred.await(releaseDestination);

            return { metadata: card, result: undefined };
          }),
        )
        .pipe(Effect.forkScoped);

      yield* Deferred.await(holdingDestination);

      const rename = yield* manager.renameDeck("/a.md", "/z.md").pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      const changingSource = yield* Deferred.make<void>();

      const sourceEdit = yield* manager
        .modifyCardMetadata("/a.md", "a", ({ card }) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(changingSource, undefined);

            return {
              metadata: { ...card, stability: numericField(42) },
              result: card.stability.value,
            };
          }),
        )
        .pipe(Effect.forkScoped);

      yield* Effect.yieldNow;
      expect(yield* Deferred.isDone(changingSource)).toBe(false);

      yield* Fiber.interrupt(rename);
      expect(Exit.hasInterrupts(yield* Fiber.await(rename))).toBe(true);
      // The source must become writable before the destination holder is released.
      expect(yield* Fiber.join(sourceEdit)).toBe(0);
      expect((yield* manager.readDeck("/a.md")).items[0]!.cards[0]!.stability.value).toBe(42);
      yield* Deferred.succeed(releaseDestination, undefined);
      yield* Fiber.join(holder);
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("finishes an in-flight save before renaming its deck", () =>
    Effect.gen(function* () {
      const manager = yield* makeManager(yield* mockFs([item("a")]));
      const pause = yield* pauseValidation;

      const edit = yield* manager
        .replaceItem("/deck.md", "a", item("a", "Saved\n"), pause.type)
        .pipe(Effect.forkScoped);

      yield* Deferred.await(pause.entered);
      const rename = yield* manager.renameDeck("/deck.md", "/moved.md").pipe(Effect.forkScoped);
      yield* TestClock.adjust(0);
      yield* Deferred.succeed(pause.release, undefined);
      yield* Fiber.join(edit);
      yield* Fiber.join(rename);

      expect((yield* manager.readDeck("/moved.md")).items[0]!.content.trim()).toBe("Saved");
      const oldPath = yield* manager.readDeck("/deck.md").pipe(Effect.result);
      expect(oldPath).toMatchObject({ _tag: "Failure", failure: { _tag: "DeckNotFound" } });
      // A rename to the same path is a no-op, not a second acquisition of its lock.
      yield* manager.renameDeck("/moved.md", "/moved.md");
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("does not recreate a deleted deck when an earlier edit finishes", () =>
    Effect.gen(function* () {
      const manager = yield* makeManager(yield* mockFs([item("a")]));
      const pause = yield* pauseValidation;

      const edit = yield* manager
        .replaceItem("/deck.md", "a", item("a", "Saved\n"), pause.type)
        .pipe(Effect.forkScoped);

      yield* Deferred.await(pause.entered);
      const deletion = yield* manager.deleteDeck("/deck.md").pipe(Effect.forkScoped);
      yield* TestClock.adjust(0);
      yield* Deferred.succeed(pause.release, undefined);
      yield* Fiber.join(edit);
      yield* Fiber.join(deletion);

      expect(yield* manager.readDeck("/deck.md").pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DeckNotFound" },
      });
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.effect("allows only one rename to claim a destination and preserves the other source", () =>
    Effect.gen(function* () {
      const fs = yield* mockFs([item("a")]);
      const destinationChecked = yield* Deferred.make<void>();
      const releaseCheck = yield* Deferred.make<void>();
      let pauseNextDestinationCheck = true;

      const manager = yield* makeManager({
        ...fs,
        stat: (path) =>
          Effect.gen(function* () {
            const result = yield* fs.stat(path).pipe(Effect.exit);

            if (path === "/moved.md" && pauseNextDestinationCheck) {
              pauseNextDestinationCheck = false;
              yield* Deferred.succeed(destinationChecked, undefined);
              yield* Deferred.await(releaseCheck);
            }

            return yield* result;
          }),
      });

      yield* manager.replaceItem("/other.md", "a", item("b"), itemType);

      const first = yield* manager
        .renameDeck("/deck.md", "/moved.md")
        .pipe(Effect.result, Effect.forkScoped);

      yield* Deferred.await(destinationChecked);

      const second = yield* manager
        .renameDeck("/other.md", "/moved.md")
        .pipe(Effect.result, Effect.forkScoped);

      // Drain runnable fibers before releasing the delayed filesystem response.
      yield* TestClock.adjust(0);
      yield* Deferred.succeed(releaseCheck, undefined);
      const results = [yield* Fiber.join(first), yield* Fiber.join(second)];

      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1);
      expect(results.find((result) => result._tag === "Failure")).toMatchObject({
        failure: { _tag: "DeckAlreadyExists", deckPath: "/moved.md" },
      });
      const firstWon = results[0]!._tag === "Success";
      expect((yield* manager.readDeck("/moved.md")).items[0]!.cards[0]!.id).toBe(
        firstWon ? "a" : "b",
      );
      expect(
        (yield* manager.readDeck(firstWon ? "/other.md" : "/deck.md")).items[0]!.cards[0]!.id,
      ).toBe(firstWon ? "b" : "a");
    }).pipe(Effect.timeout("2 seconds")),
  );
});

const diskFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer));
  const directory = yield* fs.makeTempDirectoryScoped();
  const deckPath = `${directory}/deck.md`;
  const original = serializeFile({ preamble: "", items: [item("a")] });
  yield* fs.writeFileString(deckPath, original);
  // Another tool may own this filename; a deck save must leave it alone.
  yield* fs.writeFileString(`${deckPath}.tmp`, "Other tool's file");

  return { fs, directory, deckPath, original };
});

class EditRejected extends Data.TaggedError("EditRejected")<{ readonly message: string }> {}

describe("DeckManager.modifyItem", () => {
  it.live("separates the next item's metadata when edited content has no trailing newline", () =>
    Effect.gen(function* () {
      const { fs, deckPath } = yield* diskFixture;
      yield* fs.writeFileString(
        deckPath,
        serializeFile({
          preamble: "",
          items: [item("first", "Before\n\n"), item("second", "Following item\n")],
        }),
      );
      const manager = yield* makeManager(fs);

      const saved = yield* manager.modifyItem(
        deckPath,
        "first",
        (current) => Effect.succeed({ ...current, content: "Edited" }),
        itemType,
      );

      const reread = yield* manager.readDeck(deckPath);
      expect(reread.items).toHaveLength(2);
      expect(reread.items[0]!.content).toBe("Edited\n");
      expect(reread.items[1]!).toMatchObject({
        cards: [{ id: "second" }],
        content: "Following item\n",
      });
      expect(saved.content).toBe(reread.items[0]!.content);
    }),
  );

  it.live("leaves the file byte-identical when change fails and allows a later edit", () =>
    Effect.gen(function* () {
      const { fs, deckPath } = yield* diskFixture;
      // Noncanonical spacing makes an accidental write-before-change observable.
      const original = "<!--@ a  0 0 0 0-->\nOriginal\n";
      yield* fs.writeFileString(deckPath, original);
      const manager = yield* makeManager(fs);

      const result = yield* manager
        .modifyItem(
          deckPath,
          "a",
          () => Effect.fail(new EditRejected({ message: "Rejected by edit policy" })),
          itemType,
        )
        .pipe(Effect.result);

      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "EditRejected" } });
      expect(yield* fs.readFileString(deckPath)).toBe(original);

      yield* manager.modifyItem(
        deckPath,
        "a",
        (current) => Effect.succeed({ ...current, content: "Accepted" }),
        itemType,
      );
      expect((yield* manager.readDeck(deckPath)).items[0]!.content).toBe("Accepted");
    }).pipe(Effect.timeout("2 seconds")),
  );
});

describe("DeckManager save recovery", () => {
  it.live(
    "finishes a started rename under cancellation before the next writer reads the deck",
    () =>
      Effect.gen(function* () {
        const fs = yield* mockFs([item("a")]);
        const renaming = yield* Deferred.make<void>();
        const releaseRename = yield* Deferred.make<void>();
        let pauseNextRename = true;

        const manager = yield* makeManager({
          ...fs,
          rename: (from, to) =>
            Effect.gen(function* () {
              if (pauseNextRename) {
                pauseNextRename = false;
                yield* Deferred.succeed(renaming, undefined);
                yield* Deferred.await(releaseRename);
              }

              yield* fs.rename(from, to);
            }),
        });

        const increment = manager.modifyCardMetadata("/deck.md", "a", ({ card }) =>
          Effect.succeed({
            metadata: { ...card, stability: numericField(card.stability.value + 1) },
            result: card.stability.value,
          }),
        );

        const first = yield* increment.pipe(Effect.forkScoped);
        yield* Deferred.await(renaming);
        const cancelling = yield* Fiber.interrupt(first).pipe(Effect.forkScoped);
        const second = yield* increment.pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(releaseRename, undefined);
        yield* Fiber.join(cancelling);
        expect(Exit.hasInterrupts(yield* Fiber.await(first))).toBe(true);
        expect(yield* Fiber.join(second)).toBe(1);
        expect((yield* manager.readDeck("/deck.md")).items[0]!.cards[0]!.stability.value).toBe(2);
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.live(
    "keeps the original and removes its temporary file after a failed save, then allows retry",
    () =>
      Effect.gen(function* () {
        const { fs, directory, deckPath, original } = yield* diskFixture;
        let failNextRename = true;

        const manager = yield* makeManager({
          ...fs,
          rename: (from, to) =>
            Effect.suspend(() => {
              if (failNextRename) {
                failNextRename = false;

                return Effect.fail(makeSystemError("PermissionDenied", "rename", from));
              }

              return fs.rename(from, to);
            }),
        });

        const update = manager.modifyCardMetadata(deckPath, "a", ({ card }) =>
          Effect.succeed({
            metadata: { ...card, stability: numericField(42) },
            result: "saved",
          }),
        );

        expect(yield* update.pipe(Effect.result)).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DeckWriteError", deckPath },
        });
        expect(yield* fs.readFileString(deckPath)).toBe(original);
        expect((yield* fs.readDirectory(directory)).sort()).toEqual(["deck.md", "deck.md.tmp"]);
        expect(yield* fs.readFileString(`${deckPath}.tmp`)).toBe("Other tool's file");
        expect(yield* update).toBe("saved");
        expect((yield* manager.readDeck(deckPath)).items[0]!.cards[0]!.stability.value).toBe(42);
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.live("cleans up an interrupted save and releases the deck for its next writer", () =>
    Effect.gen(function* () {
      const { fs, directory, deckPath, original } = yield* diskFixture;
      const written = yield* Deferred.make<void>();
      let pauseNextWrite = true;

      const manager = yield* makeManager({
        ...fs,
        writeFileString: (path, content, options) =>
          Effect.gen(function* () {
            yield* fs.writeFileString(path, content, options);

            if (pauseNextWrite) {
              pauseNextWrite = false;
              yield* Deferred.succeed(written, undefined);

              return yield* Effect.never;
            }
          }),
      });

      const update = manager.updateCardMetadata(deckPath, "a", {
        ...item("a").cards[0]!,
        stability: numericField(42),
      });

      const save = yield* update.pipe(Effect.forkScoped);
      yield* Deferred.await(written);
      yield* Fiber.interrupt(save);
      expect(Exit.hasInterrupts(yield* Fiber.await(save))).toBe(true);
      expect(yield* fs.readFileString(deckPath)).toBe(original);
      expect((yield* fs.readDirectory(directory)).sort()).toEqual(["deck.md", "deck.md.tmp"]);
      expect(yield* fs.readFileString(`${deckPath}.tmp`)).toBe("Other tool's file");
      yield* update;
      expect((yield* manager.readDeck(deckPath)).items[0]!.cards[0]!.stability.value).toBe(42);
    }).pipe(Effect.timeout("2 seconds")),
  );
});
