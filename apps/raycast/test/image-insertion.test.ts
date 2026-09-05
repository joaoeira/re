import { describe, expect, it } from "@effect/vitest";
import type { ItemMetadata, EvaluableItemType } from "@re/core";
import type { ImportedDeckImageAsset } from "@re/workspace";
import { Effect, Layer } from "effect";

import {
  ClipboardImageUnavailable,
  ClipboardImageReader,
  type ClipboardImageReader as ClipboardImageReaderService,
} from "../src/clipboard-image";
import { DeckStore, type DeckStore as DeckStoreService } from "../src/deck-store";
import { insertImageForUi } from "../src/image-insertion";

const clipboardImage = {
  bytes: new Uint8Array([137, 80, 78, 71]),
  extension: ".png",
};

const importedImage: ImportedDeckImageAsset = {
  contentHash: "abc123",
  extension: ".png",
  absolutePath: "/decks/.re/assets/abc123.png",
  workspaceRelativePath: ".re/assets/abc123.png",
  deckRelativePath: ".re/assets/abc123.png",
};

interface ImportCall {
  readonly workspacePath: string;
  readonly deckPath: string;
  readonly bytes: Uint8Array;
  readonly extension: string;
}

const createTestLayer = (options?: {
  readonly readImage?: ClipboardImageReaderService["readImage"];
  readonly onImport?: (call: ImportCall) => void;
}) => {
  const clipboardLayer: Layer.Layer<ClipboardImageReaderService> = Layer.succeed(
    ClipboardImageReader,
    ClipboardImageReader.of({
      readImage: options?.readImage ?? (() => Effect.succeed(clipboardImage)),
    }),
  );

  const deckStoreLayer: Layer.Layer<DeckStoreService> = Layer.succeed(
    DeckStore,
    DeckStore.of({
      listDecks: () => Effect.succeed([]),
      appendItem: (
        _deckPath: string,
        _item: {
          readonly cards: readonly ItemMetadata[];
          readonly content: string;
        },
        _itemType: EvaluableItemType,
      ) => Effect.void,
      importImageFromBytes: (workspacePath, deckPath, bytes, extension) => {
        options?.onImport?.({ workspacePath, deckPath, bytes, extension });
        return Effect.succeed(importedImage);
      },
    }),
  );

  return Layer.merge(clipboardLayer, deckStoreLayer);
};

describe("insertImageForUi", () => {
  it.effect("imports the clipboard image and appends its Markdown to existing content", () => {
    let importCall: ImportCall | undefined;

    return Effect.gen(function* () {
      const result = yield* insertImageForUi({
        workspacePath: "/decks",
        deckPath: "/decks/computing.md",
        content: "What does this diagram show?",
      });

      expect(result).toEqual({
        _tag: "Inserted",
        content: "What does this diagram show?\n\n![](.re/assets/abc123.png)",
        deckRelativePath: ".re/assets/abc123.png",
      });
      expect(importCall).toEqual({
        workspacePath: "/decks",
        deckPath: "/decks/computing.md",
        bytes: clipboardImage.bytes,
        extension: ".png",
      });
    }).pipe(
      Effect.provide(
        createTestLayer({
          onImport: (call) => {
            importCall = call;
          },
        }),
      ),
    );
  });

  it.effect("explains when the clipboard does not contain an image", () =>
    Effect.gen(function* () {
      const result = yield* insertImageForUi({
        workspacePath: "/decks",
        deckPath: "/decks/computing.md",
        content: "Question",
      });

      expect(result).toEqual({
        _tag: "OperationError",
        message: "Copy an image before using Insert Image.",
      });
    }).pipe(
      Effect.provide(
        createTestLayer({
          readImage: () =>
            Effect.fail(
              new ClipboardImageUnavailable({
                message: "Copy an image before using Insert Image.",
              }),
            ),
        }),
      ),
    ),
  );
});
