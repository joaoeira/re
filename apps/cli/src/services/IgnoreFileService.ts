import { Context, Effect, Layer } from "effect";
import { FileSystem, Path } from "@effect/platform";

export const IGNORE_FILE = ".reignore";

/** Parse a .reignore file: one filename per line, # for comments, empty lines ignored */
export const parseIgnoreFile = (content: string): Set<string> => {
  const ignored = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    ignored.add(trimmed);
  }
  return ignored;
};

export interface IgnoreMap {
  readonly isIgnored: (relativePath: string) => boolean;
}

export interface IgnoreFileService {
  readonly buildIgnoreMap: (
    rootPath: string,
    entries: readonly string[],
  ) => Effect.Effect<IgnoreMap, never>;
}

export const IgnoreFileService = Context.GenericTag<IgnoreFileService>("IgnoreFileService");

export const IgnoreFileServiceLive = Layer.effect(
  IgnoreFileService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    return {
      buildIgnoreMap: (rootPath, entries) =>
        Effect.gen(function* () {
          const ignoreMap = new Map<string, Set<string>>();

          const ignoreFiles = entries.filter((e) => path.basename(e) === IGNORE_FILE);
          for (const ignoreFile of ignoreFiles) {
            const dir = path.dirname(ignoreFile);
            const fullPath = path.join(rootPath, ignoreFile);
            const contentResult = yield* fs.readFileString(fullPath).pipe(Effect.either);
            if (contentResult._tag === "Right") {
              ignoreMap.set(dir === "." ? "" : dir, parseIgnoreFile(contentResult.right));
            }
          }

          return {
            isIgnored: (relativePath: string) => {
              const dir = path.dirname(relativePath);
              const filename = path.basename(relativePath);
              const ignoredInDir = ignoreMap.get(dir === "." ? "" : dir);
              return ignoredInDir?.has(filename) ?? false;
            },
          };
        }),
    };
  }),
);
