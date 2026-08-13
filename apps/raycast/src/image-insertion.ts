import { Effect } from "effect";

import { ClipboardImageReader } from "./clipboard-image";
import { DeckStore } from "./deck-store";

export interface InsertImageInput {
  readonly workspacePath: string;
  readonly deckPath: string;
  readonly content: string;
}

export type InsertImageUiResult =
  | {
      readonly _tag: "Inserted";
      readonly content: string;
      readonly deckRelativePath: string;
    }
  | {
      readonly _tag: "DeckPathError";
      readonly message: string;
    }
  | {
      readonly _tag: "OperationError";
      readonly message: string;
    };

const appendImageMarkdown = (content: string, deckRelativePath: string): string => {
  const separator =
    content.length === 0
      ? ""
      : content.endsWith("\n\n")
        ? ""
        : content.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${content}${separator}![](${deckRelativePath})`;
};

export const insertImageForUi = (
  input: InsertImageInput,
): Effect.Effect<InsertImageUiResult, never, ClipboardImageReader | DeckStore> =>
  Effect.gen(function* () {
    if (input.deckPath.trim().length === 0) {
      return {
        _tag: "DeckPathError",
        message: "Choose a deck before inserting an image.",
      } as const;
    }

    const clipboard = yield* ClipboardImageReader;
    const image = yield* clipboard.readImage();
    const deckStore = yield* DeckStore;
    const imported = yield* deckStore.importImageFromBytes(
      input.workspacePath,
      input.deckPath,
      image.bytes,
      image.extension,
    );

    return {
      _tag: "Inserted",
      content: appendImageMarkdown(input.content, imported.deckRelativePath),
      deckRelativePath: imported.deckRelativePath,
    } as const;
  }).pipe(
    Effect.catchTags({
      ClipboardImageUnavailable: (error) =>
        Effect.succeed<InsertImageUiResult>({
          _tag: "OperationError",
          message: error.message,
        }),
      ClipboardImageReadError: (error) =>
        Effect.succeed<InsertImageUiResult>({
          _tag: "OperationError",
          message: error.message,
        }),
      InvalidWorkspaceImageAsset: (error) =>
        Effect.succeed<InsertImageUiResult>({
          _tag: "OperationError",
          message:
            error.reason === "unsupported_file_extension"
              ? "The copied image format is not supported."
              : `Could not import the image (${error.reason}).`,
        }),
      ImportDeckImageAssetOperationError: (error) =>
        Effect.succeed<InsertImageUiResult>({
          _tag: "OperationError",
          message: `Could not save the image: ${error.message}`,
        }),
    }),
  );
