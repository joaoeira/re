import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { Array as Arr, Effect, Option, Order, Result } from "effect";
import ignore from "ignore";

const ROOT_IGNORE_FILE = ".reignore";

export interface ScanDecksOptions {
  readonly includeHidden?: boolean;
  readonly extraIgnorePatterns?: readonly string[];
}

export const DeckEntrySchema = Schema.Struct({
  absolutePath: Schema.String,
  relativePath: Schema.String,
  name: Schema.String,
});

export type DeckEntry = typeof DeckEntrySchema.Type;

export const ScanDecksResultSchema = Schema.Struct({
  rootPath: Schema.String,
  decks: Schema.Array(DeckEntrySchema),
});

export type ScanDecksResult = typeof ScanDecksResultSchema.Type;

export class WorkspaceRootNotFound extends Schema.TaggedError<WorkspaceRootNotFound>(
  "./index.js/WorkspaceRootNotFound",
)("WorkspaceRootNotFound", {
  rootPath: Schema.String,
}) {}

export class WorkspaceRootNotDirectory extends Schema.TaggedError<WorkspaceRootNotDirectory>(
  "./index.js/WorkspaceRootNotDirectory",
)("WorkspaceRootNotDirectory", {
  rootPath: Schema.String,
}) {}

export class WorkspaceRootUnreadable extends Schema.TaggedError<WorkspaceRootUnreadable>(
  "./index.js/WorkspaceRootUnreadable",
)("WorkspaceRootUnreadable", {
  rootPath: Schema.String,
  message: Schema.String,
}) {}

export const ScanDecksErrorSchema = Schema.Union([
  WorkspaceRootNotFound,
  WorkspaceRootNotDirectory,
  WorkspaceRootUnreadable,
]);

export type ScanDecksError = typeof ScanDecksErrorSchema.Type;

export const toScanDecksErrorMessage = (error: ScanDecksError): string => {
  switch (error._tag) {
    case "WorkspaceRootNotFound":
      return `Workspace root not found: ${error.rootPath}`;
    case "WorkspaceRootNotDirectory":
      return `Workspace root is not a directory: ${error.rootPath}`;
    case "WorkspaceRootUnreadable":
      return `Workspace root is unreadable: ${error.message}`;
  }
};

export const mapScanDecksErrorToError = (error: ScanDecksError | Error): Error =>
  "_tag" in error ? new Error(toScanDecksErrorMessage(error)) : error;

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

const hasHiddenSegment = (relativePath: string): boolean =>
  relativePath.split("/").some((segment) => segment.length > 0 && segment.startsWith("."));

const normalizeIgnorePatterns = (patterns: readonly string[]): readonly string[] =>
  Arr.filterMap(patterns, (pattern) => {
    const normalized = pattern.trim();
    if (normalized === "" || normalized.startsWith("#")) {
      return Result.failVoid;
    }

    return Result.succeed(normalized);
  });

const appendPatterns = (matcher: ReturnType<typeof ignore>, patterns: readonly string[]): void => {
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
    Effect.catchReasons("PlatformError", {
      NotFound: () => Effect.succeed([]),
      PermissionDenied: () => Effect.succeed([]),
    }),
    Effect.mapError((error) =>
      mapNestedFatalError(
        rootPath,
        pathService.join(rootPath, ROOT_IGNORE_FILE),
        "readFileString",
        error,
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
    Effect.catchReasons("PlatformError", {
      NotFound: () => Effect.succeed(Option.none()),
      PermissionDenied: () => Effect.succeed(Option.none()),
    }),
    Effect.mapError((error) => mapNestedFatalError(rootPath, absolutePath, "readDirectory", error)),
  );

const statBestEffort = (
  rootPath: string,
  absolutePath: string,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<Option.Option<FileSystem.File.Info>, WorkspaceRootUnreadable> =>
  fileSystem.stat(absolutePath).pipe(
    Effect.map(Option.some),
    Effect.catchReasons("PlatformError", {
      NotFound: () => Effect.succeed(Option.none()),
      PermissionDenied: () => Effect.succeed(Option.none()),
    }),
    Effect.mapError((error) => mapNestedFatalError(rootPath, absolutePath, "stat", error)),
  );

const isSymlinkBestEffort = (
  rootPath: string,
  absolutePath: string,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<Option.Option<boolean>, WorkspaceRootUnreadable> =>
  fileSystem.readLink(absolutePath).pipe(
    Effect.as(Option.some(true)),
    Effect.catchReasons(
      "PlatformError",
      {
        BadResource: () => Effect.succeed(Option.some(false)),
        InvalidData: () => Effect.succeed(Option.some(false)),
        Unknown: (reason, error) => {
          const cause = reason.cause;
          if (
            typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            cause.code === "EINVAL"
          ) {
            return Effect.succeed(Option.some(false));
          }
          return Effect.fail(mapNestedFatalError(rootPath, absolutePath, "readLink", error));
        },
        NotFound: () => Effect.succeed(Option.none()),
        PermissionDenied: () => Effect.succeed(Option.none()),
      },
      (_, error) => Effect.fail(mapNestedFatalError(rootPath, absolutePath, "readLink", error)),
    ),
  );

const normalizeOptions = (options?: ScanDecksOptions) => ({
  includeHidden: options?.includeHidden === true,
  extraIgnorePatterns: options?.extraIgnorePatterns ?? [],
});

export const scanDecks = (
  rootPath: string,
  options?: ScanDecksOptions,
): Effect.Effect<ScanDecksResult, ScanDecksError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const normalizedRootPath = pathService.resolve(rootPath);

    const rootStat = yield* fileSystem.stat(normalizedRootPath).pipe(
      Effect.catchReasons(
        "PlatformError",
        {
          NotFound: () => Effect.fail(new WorkspaceRootNotFound({ rootPath: normalizedRootPath })),
        },
        (_, error) =>
          Effect.fail(
            new WorkspaceRootUnreadable({ rootPath: normalizedRootPath, message: error.message }),
          ),
      ),
    );

    if (rootStat.type !== "Directory") {
      return yield* new WorkspaceRootNotDirectory({
        rootPath: normalizedRootPath,
      });
    }

    yield* fileSystem.readDirectory(normalizedRootPath).pipe(
      Effect.catchReasons(
        "PlatformError",
        {
          NotFound: () => Effect.fail(new WorkspaceRootNotFound({ rootPath: normalizedRootPath })),
        },
        (_, error) =>
          Effect.fail(
            new WorkspaceRootUnreadable({ rootPath: normalizedRootPath, message: error.message }),
          ),
      ),
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
        const relativePath = pathService.relative(normalizedRootPath, absolutePath);

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

        const info = yield* statBestEffort(normalizedRootPath, absolutePath, fileSystem);

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

        if (matcher.ignores(relativePath) || pathService.extname(relativePath) !== ".md") {
          continue;
        }

        decks.push({
          absolutePath: pathService.normalize(absolutePath),
          relativePath,
          name: pathService.basename(relativePath, ".md"),
        });
      }
    }

    const sortedDecks = Arr.sortWith(decks, (deck) => deck.relativePath, Order.String);

    return {
      rootPath: normalizedRootPath,
      decks: sortedDecks,
    };
  });
