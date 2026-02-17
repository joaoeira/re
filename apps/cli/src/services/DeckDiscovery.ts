import { Context, Effect, Layer, Either } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { IgnoreFileService } from "./IgnoreFileService";

export interface DiscoveryResult {
  readonly paths: string[];
  readonly error: string | null; // null = success, string = error message
}

export interface DeckDiscovery {
  readonly discoverDecks: (rootPath: string) => Effect.Effect<DiscoveryResult, never>;
}

export const DeckDiscovery = Context.GenericTag<DeckDiscovery>("DeckDiscovery");

export const DeckDiscoveryLive = Layer.effect(
  DeckDiscovery,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const ignoreService = yield* IgnoreFileService;

    return {
      discoverDecks: (rootPath) =>
        Effect.gen(function* () {
          const entriesResult = yield* fs
            .readDirectory(rootPath, { recursive: true })
            .pipe(Effect.either);

          if (Either.isLeft(entriesResult)) {
            return {
              paths: [],
              error: `Failed to read directory: ${entriesResult.left.message}`,
            };
          }

          const entries = entriesResult.right;
          const ignoreMap = yield* ignoreService.buildIgnoreMap(rootPath, entries);

          // Filter for .md files, excluding:
          // 1. Those in hidden directories
          // 2. Those listed in a .reignore file in the same directory
          const paths = entries
            .filter((entry) => {
              if (!entry.endsWith(".md")) return false;
              const segments = entry.split("/");
              // Exclude files in hidden directories
              if (segments.slice(0, -1).some((seg) => seg.startsWith("."))) {
                return false;
              }

              return !ignoreMap.isIgnored(entry);
            })
            .map((entry) => path.join(rootPath, entry));

          return { paths, error: null };
        }),
    };
  }),
);
