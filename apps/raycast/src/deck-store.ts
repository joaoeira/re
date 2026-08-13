import { FileSystem, Path } from "@effect/platform";
import type { ItemMetadata, UntypedItemType } from "@re/core";
import {
  DeckManager,
  scanDecks,
  type DeckEntry,
  type ItemValidationError,
  type ScanDecksError,
  type WriteError,
} from "@re/workspace";
import { Context, Effect, Layer } from "effect";

export interface DeckStore {
  readonly listDecks: (
    workspacePath: string,
  ) => Effect.Effect<readonly DeckEntry[], ScanDecksError>;
  readonly appendItem: (
    deckPath: string,
    item: {
      readonly cards: readonly ItemMetadata[];
      readonly content: string;
    },
    itemType: UntypedItemType,
  ) => Effect.Effect<void, WriteError | ItemValidationError>;
}

export const DeckStore = Context.GenericTag<DeckStore>("@re/raycast/DeckStore");

export const DeckStoreLive: Layer.Layer<
  DeckStore,
  never,
  DeckManager | FileSystem.FileSystem | Path.Path
> = Layer.effect(
  DeckStore,
  Effect.gen(function* () {
    const deckManager = yield* DeckManager;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return DeckStore.of({
      listDecks: (workspacePath) =>
        scanDecks(workspacePath).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.map((result) => result.decks),
        ),
      appendItem: (deckPath, item, itemType) => deckManager.appendItem(deckPath, item, itemType),
    });
  }),
);
