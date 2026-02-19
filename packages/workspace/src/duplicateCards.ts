import { FileSystem, Path } from "@effect/platform";
import type { ParsedFile } from "@re/core";
import { Effect } from "effect";

import { DeckManager } from "./DeckManager";
import { scanDecks, type ScanDecksError, type ScanDecksOptions } from "./scanDecks";

export interface CardLocation {
  readonly filePath: string;
  readonly itemIndex: number;
  readonly cardIndex: number;
  readonly id: string;
}

export type DuplicateMap = Record<string, readonly CardLocation[]>;

export interface WorkspaceDuplicateResult {
  readonly rootPath: string;
  readonly duplicates: DuplicateMap;
  readonly scannedDecks: number;
  readonly loadedDecks: number;
  readonly skippedDecks: number;
}

const READ_CONCURRENCY = 16;

export const extractCardLocations = (
  decks: readonly { path: string; file: ParsedFile }[],
): readonly CardLocation[] => {
  const locations: CardLocation[] = [];

  for (const deck of decks) {
    for (let itemIndex = 0; itemIndex < deck.file.items.length; itemIndex++) {
      const item = deck.file.items[itemIndex]!;
      for (let cardIndex = 0; cardIndex < item.cards.length; cardIndex++) {
        const card = item.cards[cardIndex]!;
        locations.push({
          filePath: deck.path,
          itemIndex,
          cardIndex,
          id: card.id,
        });
      }
    }
  }

  return locations;
};

export const findDuplicates = (locations: readonly CardLocation[]): DuplicateMap => {
  const grouped = new Map<string, CardLocation[]>();

  for (const location of locations) {
    const current = grouped.get(location.id);
    if (current) {
      current.push(location);
    } else {
      grouped.set(location.id, [location]);
    }
  }

  const duplicates: [string, readonly CardLocation[]][] = [];
  for (const [id, locs] of grouped.entries()) {
    if (locs.length > 1) {
      duplicates.push([id, locs]);
    }
  }

  return Object.fromEntries(duplicates) as DuplicateMap;
};

export const findWorkspaceDuplicates = (
  rootPath: string,
  options?: ScanDecksOptions,
): Effect.Effect<
  WorkspaceDuplicateResult,
  ScanDecksError,
  DeckManager | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const deckManager = yield* DeckManager;
    const scanResult = yield* scanDecks(rootPath, options);
    const deckPaths = scanResult.decks.map((deck) => deck.absolutePath);

    const readResults = yield* Effect.all(
      deckPaths.map((deckPath) => deckManager.readDeck(deckPath).pipe(Effect.either)),
      { concurrency: READ_CONCURRENCY },
    );

    const loadedDecks: { path: string; file: ParsedFile }[] = [];
    for (let i = 0; i < readResults.length; i++) {
      const result = readResults[i]!;
      if (result._tag === "Right") {
        loadedDecks.push({ path: deckPaths[i]!, file: result.right });
      }
    }

    const scannedDecks = deckPaths.length;
    const loadedDecksCount = loadedDecks.length;

    return {
      rootPath: scanResult.rootPath,
      duplicates: findDuplicates(extractCardLocations(loadedDecks)),
      scannedDecks,
      loadedDecks: loadedDecksCount,
      skippedDecks: scannedDecks - loadedDecksCount,
    };
  });
