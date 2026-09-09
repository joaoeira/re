import * as FileSystem from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import { describe, expect, it } from "@effect/vitest";
import { DeckManagerLive } from "../../src/workspace/index.js";
import { Effect, Layer } from "effect";

import {
  createCardForUi,
  loadDecksForUi,
  DeckStore,
  DeckStoreLive,
} from "../../src/study/index.js";

const PlatformLive = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const DeckManagerAndPlatformLive = DeckManagerLive.pipe(Layer.provideMerge(PlatformLive));
const TestLive = DeckStoreLive.pipe(Layer.provideMerge(DeckManagerAndPlatformLive));

describe("DeckStoreLive", () => {
  it.effect("discovers a deck and writes a card through the real filesystem adapter", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/computing.md`;
      yield* fileSystem.writeFileString(deckPath, "# Computing\n");

      const scanned = yield* loadDecksForUi(workspacePath);
      expect(scanned._tag).toBe("DecksLoaded");
      if (scanned._tag === "DecksLoaded") {
        expect(scanned.decks.map((deck) => deck.relativePath)).toEqual(["computing.md"]);
      }

      const created = yield* createCardForUi({
        cardType: "qa",
        deckPath,
        question: "What does Effect track?",
        answer: "Success, expected errors, and requirements.",
        content: "",
      });
      expect(created).toEqual({ _tag: "Created", cardCount: 1 });

      const written = yield* fileSystem.readFileString(deckPath);
      expect(written).toContain("<!--@");
      expect(written).toContain(
        "What does Effect track?\n---\nSuccess, expected errors, and requirements.",
      );
    }).pipe(Effect.provide(TestLive)),
  );

  it.effect("stores an imported image in the workspace asset directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const deckStore = yield* DeckStore;
      const workspacePath = yield* fileSystem.makeTempDirectoryScoped();
      const deckPath = `${workspacePath}/computing.md`;
      const bytes = new Uint8Array([137, 80, 78, 71]);
      yield* fileSystem.writeFileString(deckPath, "# Computing\n");

      const imported = yield* deckStore.importImageFromBytes(
        workspacePath,
        deckPath,
        bytes,
        ".png",
      );

      expect(imported.deckRelativePath).toMatch(/^\.re\/assets\/[a-f0-9]{64}\.png$/);
      expect(Array.from(yield* fileSystem.readFile(imported.absolutePath))).toEqual(
        Array.from(bytes),
      );
    }).pipe(Effect.provide(TestLive)),
  );
});
