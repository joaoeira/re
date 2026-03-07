import { FileSystem, Path } from "@effect/platform";
import type { PlatformError } from "@effect/platform/Error";
import { Effect, Schema } from "effect";

import { isPathWithinRoot } from "./imagePaths";

export const WORKSPACE_INTERNAL_DIRECTORY_NAME = ".re";
export const WORKSPACE_IMAGE_ASSETS_DIRECTORY_NAME = "assets";
export const WORKSPACE_IMAGE_ASSETS_RELATIVE_PATH = `${WORKSPACE_INTERNAL_DIRECTORY_NAME}/${WORKSPACE_IMAGE_ASSETS_DIRECTORY_NAME}`;

export const InvalidWorkspaceImageAssetReasonSchema = Schema.Literal(
  "absolute_root_path_required",
  "absolute_deck_path_required",
  "absolute_source_path_required",
  "deck_outside_root",
  "missing_file_extension",
);

export type InvalidWorkspaceImageAssetReason = typeof InvalidWorkspaceImageAssetReasonSchema.Type;

export class InvalidWorkspaceImageAsset extends Schema.TaggedError<InvalidWorkspaceImageAsset>(
  "@re/workspace/InvalidWorkspaceImageAsset",
)("InvalidWorkspaceImageAsset", {
  rootPath: Schema.String,
  deckPath: Schema.optional(Schema.String),
  sourcePath: Schema.optional(Schema.String),
  reason: InvalidWorkspaceImageAssetReasonSchema,
}) {}

export const ImportDeckImageAssetOperationSchema = Schema.Literal(
  "read_source",
  "hash_source",
  "create_assets_directory",
  "write_asset",
);

export type ImportDeckImageAssetOperation = typeof ImportDeckImageAssetOperationSchema.Type;

export class ImportDeckImageAssetOperationError extends Schema.TaggedError<ImportDeckImageAssetOperationError>(
  "@re/workspace/ImportDeckImageAssetOperationError",
)("ImportDeckImageAssetOperationError", {
  operation: ImportDeckImageAssetOperationSchema,
  message: Schema.String,
  sourcePath: Schema.optional(Schema.String),
  assetPath: Schema.optional(Schema.String),
}) {}

export const ImportedDeckImageAssetSchema = Schema.Struct({
  contentHash: Schema.String,
  extension: Schema.String,
  absolutePath: Schema.String,
  workspaceRelativePath: Schema.String,
  deckRelativePath: Schema.String,
});

export type ImportedDeckImageAsset = typeof ImportedDeckImageAssetSchema.Type;

const toErrorMessage = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof (error as { readonly message?: unknown }).message === "string"
    ? (error as { readonly message: string }).message
    : String(error);

const toMarkdownRelativePath = (path: string): string => path.replaceAll("\\", "/");

const toSha256Hex = (sourcePath: string, bytes: Uint8Array) =>
  Effect.tryPromise({
    try: async () => {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    catch: (error) =>
      new ImportDeckImageAssetOperationError({
        operation: "hash_source",
        message: toErrorMessage(error),
        sourcePath,
      }),
  });

export const getWorkspaceImageAssetsDirectory = (
  rootPath: string,
): Effect.Effect<string, InvalidWorkspaceImageAsset, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;

    if (!pathService.isAbsolute(rootPath)) {
      return yield* new InvalidWorkspaceImageAsset({
        rootPath,
        reason: "absolute_root_path_required",
      });
    }

    return pathService.normalize(
      pathService.join(pathService.resolve(rootPath), WORKSPACE_IMAGE_ASSETS_RELATIVE_PATH),
    );
  });

export const importDeckImageAsset = (options: {
  readonly rootPath: string;
  readonly deckPath: string;
  readonly sourcePath: string;
}): Effect.Effect<
  ImportedDeckImageAsset,
  InvalidWorkspaceImageAsset | ImportDeckImageAssetOperationError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    if (!pathService.isAbsolute(options.rootPath)) {
      return yield* new InvalidWorkspaceImageAsset({
        rootPath: options.rootPath,
        deckPath: options.deckPath,
        sourcePath: options.sourcePath,
        reason: "absolute_root_path_required",
      });
    }

    if (!pathService.isAbsolute(options.deckPath)) {
      return yield* new InvalidWorkspaceImageAsset({
        rootPath: options.rootPath,
        deckPath: options.deckPath,
        sourcePath: options.sourcePath,
        reason: "absolute_deck_path_required",
      });
    }

    if (!pathService.isAbsolute(options.sourcePath)) {
      return yield* new InvalidWorkspaceImageAsset({
        rootPath: options.rootPath,
        deckPath: options.deckPath,
        sourcePath: options.sourcePath,
        reason: "absolute_source_path_required",
      });
    }

    const resolvedRootPath = pathService.resolve(options.rootPath);
    const resolvedDeckPath = pathService.resolve(options.deckPath);
    const resolvedSourcePath = pathService.resolve(options.sourcePath);

    const deckWithinRoot = yield* isPathWithinRoot(resolvedRootPath, resolvedDeckPath);
    if (!deckWithinRoot) {
      return yield* new InvalidWorkspaceImageAsset({
        rootPath: options.rootPath,
        deckPath: options.deckPath,
        sourcePath: options.sourcePath,
        reason: "deck_outside_root",
      });
    }

    const extension = pathService.extname(resolvedSourcePath).trim().toLowerCase();
    if (extension.length === 0) {
      return yield* new InvalidWorkspaceImageAsset({
        rootPath: options.rootPath,
        deckPath: options.deckPath,
        sourcePath: options.sourcePath,
        reason: "missing_file_extension",
      });
    }

    const sourceBytes = yield* fileSystem.readFile(resolvedSourcePath).pipe(
      Effect.mapError(
        (error: PlatformError) =>
          new ImportDeckImageAssetOperationError({
            operation: "read_source",
            message: error.message,
            sourcePath: resolvedSourcePath,
          }),
      ),
    );

    const contentHash = yield* toSha256Hex(resolvedSourcePath, sourceBytes);
    const assetsDirectory = yield* getWorkspaceImageAssetsDirectory(resolvedRootPath);
    // Keep the normalized extension in the canonical filename so downstream
    // runtimes retain a stable file-type hint for the stored asset.
    const absolutePath = pathService.normalize(
      pathService.join(assetsDirectory, `${contentHash}${extension}`),
    );

    yield* fileSystem.makeDirectory(assetsDirectory, { recursive: true }).pipe(
      Effect.mapError(
        (error: PlatformError) =>
          new ImportDeckImageAssetOperationError({
            operation: "create_assets_directory",
            message: error.message,
            assetPath: assetsDirectory,
          }),
      ),
    );

    yield* fileSystem.writeFile(absolutePath, sourceBytes, { flag: "wx" }).pipe(
      Effect.catchTags({
        SystemError: (error) =>
          error.reason === "AlreadyExists"
            ? Effect.void
            : Effect.fail(
                new ImportDeckImageAssetOperationError({
                  operation: "write_asset",
                  message: error.message,
                  sourcePath: resolvedSourcePath,
                  assetPath: absolutePath,
                }),
              ),
        BadArgument: (error) =>
          Effect.fail(
            new ImportDeckImageAssetOperationError({
              operation: "write_asset",
              message: error.message,
              sourcePath: resolvedSourcePath,
              assetPath: absolutePath,
            }),
          ),
      }),
    );

    return {
      contentHash,
      extension,
      absolutePath,
      workspaceRelativePath: pathService.relative(resolvedRootPath, absolutePath),
      deckRelativePath: toMarkdownRelativePath(
        pathService.relative(pathService.dirname(resolvedDeckPath), absolutePath),
      ),
    };
  });
