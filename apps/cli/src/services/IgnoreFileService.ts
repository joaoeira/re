import { Context, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import * as nodePath from "node:path";

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
    entries: readonly string[]
  ) => Effect.Effect<IgnoreMap, never>;
}

export const IgnoreFileService =
  Context.GenericTag<IgnoreFileService>("IgnoreFileService");

export const IgnoreFileServiceLive = Layer.effect(
  IgnoreFileService,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return {
      buildIgnoreMap: (rootPath, entries) =>
        Effect.gen(function* () {
          const ignoreMap = new Map<string, Set<string>>();

          const ignoreFiles = entries.filter(
            (e) => nodePath.basename(e) === IGNORE_FILE
          );
          for (const ignoreFile of ignoreFiles) {
            const dir = nodePath.dirname(ignoreFile);
            const fullPath = nodePath.join(rootPath, ignoreFile);
            const contentResult = yield* fs
              .readFileString(fullPath)
              .pipe(Effect.either);
            if (contentResult._tag === "Right") {
              ignoreMap.set(
                dir === "." ? "" : dir,
                parseIgnoreFile(contentResult.right)
              );
            }
          }

          return {
            isIgnored: (relativePath: string) => {
              const dir = nodePath.dirname(relativePath);
              const filename = nodePath.basename(relativePath);
              const ignoredInDir = ignoreMap.get(dir === "." ? "" : dir);
              return ignoredInDir?.has(filename) ?? false;
            },
          };
        }),
    };
  })
);
