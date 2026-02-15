import * as S from "@effect/schema/Schema";
import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Array as Arr, Effect, Option, Order } from "effect";
import ignore from "ignore";

const ROOT_IGNORE_FILE = ".reignore";

export interface ScanDecksOptions {
  readonly includeHidden?: boolean;
  readonly extraIgnorePatterns?: readonly string[];
}

export const DeckEntrySchema = S.Struct({
  absolutePath: S.String,
  relativePath: S.String,
  name: S.String,
});

export type DeckEntry = S.Schema.Type<typeof DeckEntrySchema>;

export const ScanDecksResultSchema = S.Struct({
  rootPath: S.String,
  decks: S.Array(DeckEntrySchema),
});

export type ScanDecksResult = S.Schema.Type<typeof ScanDecksResultSchema>;

export class WorkspaceRootNotFound extends S.TaggedError<WorkspaceRootNotFound>(
  "@re/workspace/WorkspaceRootNotFound",
)("WorkspaceRootNotFound", {
  rootPath: S.String,
}) {}

export class WorkspaceRootNotDirectory extends S.TaggedError<WorkspaceRootNotDirectory>(
  "@re/workspace/WorkspaceRootNotDirectory",
)("WorkspaceRootNotDirectory", {
  rootPath: S.String,
}) {}

export class WorkspaceRootUnreadable extends S.TaggedError<WorkspaceRootUnreadable>(
  "@re/workspace/WorkspaceRootUnreadable",
)("WorkspaceRootUnreadable", {
  rootPath: S.String,
  message: S.String,
}) {}

export const ScanDecksErrorSchema = S.Union(
  WorkspaceRootNotFound,
  WorkspaceRootNotDirectory,
  WorkspaceRootUnreadable,
);

export type ScanDecksError = S.Schema.Type<typeof ScanDecksErrorSchema>;

const isNestedTolerable = (error: PlatformError): boolean =>
  error._tag === "SystemError" &&
  (error.reason === "PermissionDenied" || error.reason === "NotFound");

const mapRootError = (
  rootPath: string,
  error: PlatformError,
): ScanDecksError => {
  if (error._tag === "SystemError" && error.reason === "NotFound") {
    return new WorkspaceRootNotFound({ rootPath });
  }

  return new WorkspaceRootUnreadable({
    rootPath,
    message: error.message,
  });
};

const mapNestedFatalError = (
  rootPath: string,
  absolutePath: string,
  operation: string,
  error: PlatformError,
): WorkspaceRootUnreadable =>
  new WorkspaceRootUnreadable({
    rootPath,
    message: `${operation} failed for ${absolutePath}: ${error.message}`,
  });

const hasCauseCode = (
  error: PlatformError,
  code: string,
): boolean => {
  if (error._tag !== "SystemError") {
    return false;
  }

  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("code" in cause)) {
    return false;
  }

  return (cause as { readonly code?: unknown }).code === code;
};

const hasHiddenSegment = (relativePath: string): boolean =>
  relativePath
    .split("/")
    .some((segment) => segment.length > 0 && segment.startsWith("."));

const normalizeIgnorePatterns = (
  patterns: readonly string[],
): readonly string[] =>
  Arr.filterMap(patterns, (pattern) => {
    const normalized = pattern.trim();
    if (normalized === "" || normalized.startsWith("#")) {
      return Option.none();
    }

    return Option.some(normalized);
  });

const appendPatterns = (
  matcher: ReturnType<typeof ignore>,
  patterns: readonly string[],
): void => {
  for (const pattern of normalizeIgnorePatterns(patterns)) {
    try {
      matcher.add(pattern);
    } catch {
      // Ignore malformed patterns and continue scanning.
    }
  }
};

const readRootIgnorePatterns = (
  rootPath: string,
  pathService: Path.Path,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<readonly string[], WorkspaceRootUnreadable> =>
  fileSystem.readFileString(pathService.join(rootPath, ROOT_IGNORE_FILE)).pipe(
    Effect.map((content) => normalizeIgnorePatterns(content.split(/\r?\n/))),
    Effect.catchTag("SystemError", (error) => {
      if (error.reason === "NotFound" || error.reason === "PermissionDenied") {
        return Effect.succeed([]);
      }

      return Effect.fail(
        mapNestedFatalError(
          rootPath,
          pathService.join(rootPath, ROOT_IGNORE_FILE),
          "readFileString",
          error,
        ),
      );
    }),
    Effect.catchTag("BadArgument", (error) =>
      Effect.fail(
        mapNestedFatalError(
          rootPath,
          pathService.join(rootPath, ROOT_IGNORE_FILE),
          "readFileString",
          error,
        ),
      ),
    ),
  );

const readDirectoryBestEffort = (
  rootPath: string,
  absolutePath: string,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<Option.Option<readonly string[]>, WorkspaceRootUnreadable> =>
  fileSystem.readDirectory(absolutePath).pipe(
    Effect.map((entries) => Option.some(entries as readonly string[])),
    Effect.catchAll((error) => {
      if (isNestedTolerable(error)) {
        return Effect.succeed(Option.none());
      }

      return Effect.fail(
        mapNestedFatalError(rootPath, absolutePath, "readDirectory", error),
      );
    }),
  );

const statBestEffort = (
  rootPath: string,
  absolutePath: string,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<
  Option.Option<FileSystem.File.Info>,
  WorkspaceRootUnreadable
> =>
  fileSystem.stat(absolutePath).pipe(
    Effect.map(Option.some),
    Effect.catchAll((error) => {
      if (isNestedTolerable(error)) {
        return Effect.succeed(Option.none());
      }

      return Effect.fail(
        mapNestedFatalError(rootPath, absolutePath, "stat", error),
      );
    }),
  );

const isSymlinkBestEffort = (
  rootPath: string,
  absolutePath: string,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<Option.Option<boolean>, WorkspaceRootUnreadable> =>
  fileSystem.readLink(absolutePath).pipe(
    Effect.as(Option.some(true)),
    Effect.catchTag("SystemError", (error) => {
      if (error.reason === "BadResource" || error.reason === "InvalidData") {
        return Effect.succeed(Option.some(false));
      }

      if (error.reason === "Unknown" && hasCauseCode(error, "EINVAL")) {
        return Effect.succeed(Option.some(false));
      }

      if (error.reason === "NotFound" || error.reason === "PermissionDenied") {
        return Effect.succeed(Option.none());
      }

      return Effect.fail(
        mapNestedFatalError(rootPath, absolutePath, "readLink", error),
      );
    }),
    Effect.catchTag("BadArgument", (error) =>
      Effect.fail(
        mapNestedFatalError(rootPath, absolutePath, "readLink", error),
      ),
    ),
  );

const normalizeOptions = (options?: ScanDecksOptions) => ({
  includeHidden: options?.includeHidden === true,
  extraIgnorePatterns: options?.extraIgnorePatterns ?? [],
});

export const scanDecks = (
  rootPath: string,
  options?: ScanDecksOptions,
): Effect.Effect<
  ScanDecksResult,
  ScanDecksError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const normalizedRootPath = pathService.resolve(rootPath);

    const rootStat = yield* fileSystem
      .stat(normalizedRootPath)
      .pipe(
        Effect.mapError((error) => mapRootError(normalizedRootPath, error)),
      );

    if (rootStat.type !== "Directory") {
      return yield* new WorkspaceRootNotDirectory({
        rootPath: normalizedRootPath,
      });
    }

    yield* fileSystem
      .readDirectory(normalizedRootPath)
      .pipe(
        Effect.mapError((error) => mapRootError(normalizedRootPath, error)),
      );

    const resolved = normalizeOptions(options);
    const matcher = ignore();

    const rootIgnorePatterns = yield* readRootIgnorePatterns(
      normalizedRootPath,
      pathService,
      fileSystem,
    );

    appendPatterns(matcher, rootIgnorePatterns);
    appendPatterns(matcher, resolved.extraIgnorePatterns);

    const decks: DeckEntry[] = [];
    const directories: string[] = [normalizedRootPath];

    while (directories.length > 0) {
      const currentDirectory = directories.pop()!;

      const directoryEntries = yield* readDirectoryBestEffort(
        normalizedRootPath,
        currentDirectory,
        fileSystem,
      );

      if (Option.isNone(directoryEntries)) {
        continue;
      }

      for (const entryName of directoryEntries.value) {
        const absolutePath = pathService.join(currentDirectory, entryName);
        const relativePath = pathService.relative(
          normalizedRootPath,
          absolutePath,
        );

        if (!resolved.includeHidden && hasHiddenSegment(relativePath)) {
          continue;
        }

        const symlinkCheck = yield* isSymlinkBestEffort(
          normalizedRootPath,
          absolutePath,
          fileSystem,
        );

        if (Option.isNone(symlinkCheck) || symlinkCheck.value) {
          continue;
        }

        const info = yield* statBestEffort(
          normalizedRootPath,
          absolutePath,
          fileSystem,
        );

        if (Option.isNone(info)) {
          continue;
        }

        if (info.value.type === "Directory") {
          if (matcher.ignores(`${relativePath}/`)) {
            continue;
          }

          directories.push(absolutePath);
          continue;
        }

        if (info.value.type !== "File") {
          continue;
        }

        if (
          matcher.ignores(relativePath) ||
          pathService.extname(relativePath) !== ".md"
        ) {
          continue;
        }

        decks.push({
          absolutePath: pathService.normalize(absolutePath),
          relativePath,
          name: pathService.basename(relativePath, ".md"),
        });
      }
    }

    const sortedDecks = Arr.sortBy(
      Order.mapInput(Order.string, (deck: DeckEntry) => deck.relativePath),
    )(decks);

    return {
      rootPath: normalizedRootPath,
      decks: sortedDecks,
    };
  });
