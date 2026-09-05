import { FileSystem, Path } from "@effect/platform";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { describe, expect, it } from "@effect/vitest";
import {
  createMetadataWithId,
  numericField,
  serializeFile,
  type EvaluableItemType,
  type Item,
  type ItemId,
} from "@re/core";
import { Deferred, Effect, Exit, Fiber, Layer, TestClock } from "effect";

import { DeckManager, DeckManagerLive } from "../src";
import { createMockFileSystem, makeSystemError } from "./mock-file-system";

const item = (id: string, content = `${id}\n`): Item => ({
  cards: [createMetadataWithId(id as ItemId)],
  content,
});

const itemType: EvaluableItemType = {
  name: "single-card",
  parseCards: () =>
    Effect.succeed([
      { prompt: "", reveal: "", cardType: "basic", evaluate: () => Effect.succeed(0 as const) },
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
        Effect.zipRight(Deferred.await(release)),
        Effect.zipRight(itemType.parseCards(content)),
      ),
  };
  return { entered, release, type };
});

describe("DeckManager concurrent mutations", () => {
  it.scopedLive(
    "preserves independent changes made concurrently through every edit operation",
    () =>
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
          readFileString: (path) =>
            fs.readFileString(path).pipe(Effect.tap(() => Effect.yieldNow())),
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

  it.scopedLive("lets another deck save while an edit is waiting for validation", () =>
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

  it.scoped("cancels a waiting edit without saving it or blocking later edits", () =>
    Effect.gen(function* () {
      const manager = yield* makeManager(yield* mockFs([item("a"), item("b")]));
      const pause = yield* pauseValidation;
      const edit = yield* manager
        .replaceItem("/deck.md", "a", item("a", "Saved\n"), pause.type)
        .pipe(Effect.forkScoped);
      yield* Deferred.await(pause.entered);
      const cancelled = yield* manager.removeItem("/deck.md", "b").pipe(Effect.forkScoped);
      yield* TestClock.adjust(0);
      expect(Exit.isInterrupted(yield* Fiber.interrupt(cancelled))).toBe(true);
      yield* Deferred.succeed(pause.release, undefined);
      yield* Fiber.join(edit);
      yield* manager.appendItem("/deck.md", item("c"), itemType);
      const saved = yield* manager.readDeck("/deck.md");
      expect(saved.items.map((entry) => entry.cards[0]!.id)).toEqual(["a", "b", "c"]);
      expect(saved.items[0]!.content.trim()).toBe("Saved");
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.scoped("finishes an in-flight save before renaming its deck", () =>
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
      const oldPath = yield* manager.readDeck("/deck.md").pipe(Effect.either);
      expect(oldPath).toMatchObject({ _tag: "Left", left: { _tag: "DeckNotFound" } });
      // A rename to the same path is a no-op, not a second acquisition of its lock.
      yield* manager.renameDeck("/moved.md", "/moved.md");
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.scoped("does not recreate a deleted deck when an earlier edit finishes", () =>
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

      expect(yield* manager.readDeck("/deck.md").pipe(Effect.either)).toMatchObject({
        _tag: "Left",
        left: { _tag: "DeckNotFound" },
      });
    }).pipe(Effect.timeout("2 seconds")),
  );

  it.scoped("allows only one rename to claim a destination and preserves the other source", () =>
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
        .pipe(Effect.either, Effect.forkScoped);
      yield* Deferred.await(destinationChecked);
      const second = yield* manager
        .renameDeck("/other.md", "/moved.md")
        .pipe(Effect.either, Effect.forkScoped);
      // Drain runnable fibers before releasing the delayed filesystem response.
      yield* TestClock.adjust(0);
      yield* Deferred.succeed(releaseCheck, undefined);
      const results = [yield* Fiber.join(first), yield* Fiber.join(second)];

      expect(results.filter((result) => result._tag === "Right")).toHaveLength(1);
      expect(results.find((result) => result._tag === "Left")).toMatchObject({
        left: { _tag: "DeckAlreadyExists", deckPath: "/moved.md" },
      });
      const firstWon = results[0]!._tag === "Right";
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

describe("DeckManager save recovery", () => {
  it.scopedLive(
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
        const update = manager.updateCardMetadata(deckPath, "a", {
          ...item("a").cards[0]!,
          stability: numericField(42),
        });
        expect(yield* update.pipe(Effect.either)).toMatchObject({
          _tag: "Left",
          left: { _tag: "DeckWriteError", deckPath },
        });
        expect(yield* fs.readFileString(deckPath)).toBe(original);
        expect((yield* fs.readDirectory(directory)).sort()).toEqual(["deck.md", "deck.md.tmp"]);
        expect(yield* fs.readFileString(`${deckPath}.tmp`)).toBe("Other tool's file");
        yield* update;
        expect((yield* manager.readDeck(deckPath)).items[0]!.cards[0]!.stability.value).toBe(42);
      }).pipe(Effect.timeout("2 seconds")),
  );

  it.scopedLive("cleans up an interrupted save and releases the deck for its next writer", () =>
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
      expect(Exit.isInterrupted(yield* Fiber.interrupt(save))).toBe(true);
      expect(yield* fs.readFileString(deckPath)).toBe(original);
      expect((yield* fs.readDirectory(directory)).sort()).toEqual(["deck.md", "deck.md.tmp"]);
      expect(yield* fs.readFileString(`${deckPath}.tmp`)).toBe("Other tool's file");
      yield* update;
      expect((yield* manager.readDeck(deckPath)).items[0]!.cards[0]!.stability.value).toBe(42);
    }).pipe(Effect.timeout("2 seconds")),
  );
});
