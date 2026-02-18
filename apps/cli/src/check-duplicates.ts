#!/usr/bin/env bun
import { Effect, Layer, Array, Record, pipe } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { Path } from "@effect/platform";
import type { ParsedFile } from "@re/core";
import { DeckManager, DeckManagerLive } from "@re/workspace";
import { DeckDiscovery, DeckDiscoveryLive, IgnoreFileServiceLive } from "./services";

export interface CardLocation {
  readonly filePath: string;
  readonly itemIndex: number;
  readonly cardIndex: number;
  readonly id: string;
}

export type DuplicateMap = Record<string, readonly CardLocation[]>;

export const extractCardLocations = (
  decks: readonly { path: string; file: ParsedFile }[],
): readonly CardLocation[] =>
  pipe(
    decks,
    Array.flatMap((deck) =>
      Array.flatMap(deck.file.items, (item, itemIndex) =>
        Array.map(item.cards, (card, cardIndex) => ({
          filePath: deck.path,
          itemIndex,
          cardIndex,
          id: card.id,
        })),
      ),
    ),
  );

export const findDuplicates = (locations: readonly CardLocation[]): DuplicateMap =>
  pipe(
    locations,
    Array.groupBy((loc) => loc.id),
    Record.filter((locs) => locs.length > 1),
  );

export const formatDuplicates = (duplicates: DuplicateMap): string => {
  const entries = Record.toEntries(duplicates);

  if (entries.length === 0) {
    return "No duplicate IDs found";
  }

  const lines = Array.flatMap(entries, ([id, locs]) => [
    `Duplicate ID: ${id}`,
    ...Array.map(
      locs,
      (loc) => `  - ${loc.filePath} (item ${loc.itemIndex}, card ${loc.cardIndex})`,
    ),
    "",
  ]);

  return [...lines, `Found ${entries.length} duplicate ID(s)`].join("\n");
};

const program = Effect.gen(function* () {
  const discovery = yield* DeckDiscovery;
  const deckManager = yield* DeckManager;

  const rootPath = process.cwd();
  const result = yield* discovery.discoverDecks(rootPath);

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.paths.length === 0) {
    console.log("No deck files found");
    return;
  }

  const results = yield* Effect.all(
    result.paths.map((p) => deckManager.readDeck(p).pipe(Effect.either)),
    { concurrency: "unbounded" },
  );

  const decks: { path: string; file: import("@re/core").ParsedFile }[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r._tag === "Right") {
      decks.push({ path: result.paths[i]!, file: r.right });
    }
  }

  const locations = extractCardLocations(decks);
  const duplicates = findDuplicates(locations);
  console.log(formatDuplicates(duplicates));
});

const FileSystemAndPath = Layer.mergeAll(BunFileSystem.layer, Path.layer);

export const CheckDuplicatesLive = Layer.mergeAll(
  DeckManagerLive,
  DeckDiscoveryLive.pipe(Layer.provide(IgnoreFileServiceLive)),
).pipe(Layer.provide(FileSystemAndPath));

if (import.meta.main) {
  Effect.runPromise(program.pipe(Effect.provide(CheckDuplicatesLive)));
}
