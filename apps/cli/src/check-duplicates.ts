#!/usr/bin/env bun
import { Effect, Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { Path } from "@effect/platform";
import { DeckManagerLive, findWorkspaceDuplicates, type DuplicateMap } from "@re/workspace";

export const formatDuplicates = (duplicates: DuplicateMap): string => {
  const entries = Object.entries(duplicates);

  if (entries.length === 0) {
    return "No duplicate IDs found";
  }

  const lines = entries.flatMap(([id, locs]) => [
    `Duplicate ID: ${id}`,
    ...locs.map((loc) => `  - ${loc.filePath} (item ${loc.itemIndex}, card ${loc.cardIndex})`),
    "",
  ]);

  return [...lines, `Found ${entries.length} duplicate ID(s)`].join("\n");
};

const program = Effect.gen(function* () {
  const rootPath = process.cwd();
  const result = yield* findWorkspaceDuplicates(rootPath).pipe(Effect.either);
  if (result._tag === "Left") {
    console.error(result.left.message);
    process.exit(1);
  }

  if (result.right.scannedDecks === 0) {
    console.log("No deck files found");
    return;
  }

  console.log(formatDuplicates(result.right.duplicates));
});

const FileSystemAndPath = Layer.mergeAll(BunFileSystem.layer, Path.layer);

export const CheckDuplicatesLive = Layer.mergeAll(
  FileSystemAndPath,
  DeckManagerLive.pipe(Layer.provide(FileSystemAndPath)),
);

if (import.meta.main) {
  Effect.runPromise(program.pipe(Effect.provide(CheckDuplicatesLive)));
}
