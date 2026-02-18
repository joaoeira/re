import { FileSystem } from "@effect/platform";
import { SystemError, type SystemErrorReason } from "@effect/platform/Error";
import { Effect, Layer, Option } from "effect";

export interface MockFileSystemConfig {
  readonly entryTypes: Record<string, FileSystem.File.Type>;
  readonly directories: Record<string, readonly string[]>;
  readonly fileContents?: Record<string, string>;
  readonly symlinkTargets?: Record<string, string>;
  readonly readDirectoryErrors?: Record<string, SystemErrorReason>;
  readonly statErrors?: Record<string, SystemErrorReason>;
  readonly readFileErrors?: Record<string, SystemErrorReason>;
  readonly readLinkErrors?: Record<string, SystemErrorReason>;
  readonly writeFileErrors?: Record<string, SystemErrorReason>;
  readonly renameErrors?: Record<string, SystemErrorReason>;
}

export const makeSystemError = (
  reason: SystemErrorReason,
  method: string,
  pathOrDescriptor: string,
): SystemError =>
  new SystemError({
    reason,
    module: "FileSystem",
    method,
    pathOrDescriptor,
  });

const makeFileInfo = (type: FileSystem.File.Type): FileSystem.File.Info => ({
  type,
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(0),
  blksize: Option.none(),
  blocks: Option.none(),
});

export interface MockFileSystem {
  readonly layer: Layer.Layer<FileSystem.FileSystem>;
  readonly store: Record<string, string>;
}

export const createMockFileSystem = (config: MockFileSystemConfig): MockFileSystem => {
  const store: Record<string, string> = { ...config.fileContents };

  const layer = FileSystem.layerNoop({
    readDirectory: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.readDirectoryErrors?.[targetPath];
        if (forced) {
          return yield* Effect.fail(makeSystemError(forced, "readDirectory", targetPath));
        }

        const entries = config.directories[targetPath];
        if (entries) {
          return [...entries];
        }

        if (config.entryTypes[targetPath]) {
          return yield* Effect.fail(makeSystemError("BadResource", "readDirectory", targetPath));
        }

        return yield* Effect.fail(makeSystemError("NotFound", "readDirectory", targetPath));
      }),

    readFileString: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.readFileErrors?.[targetPath];
        if (forced) {
          return yield* Effect.fail(makeSystemError(forced, "readFileString", targetPath));
        }

        const content = store[targetPath];
        if (content !== undefined) {
          return content;
        }

        if (config.entryTypes[targetPath]) {
          return yield* Effect.fail(makeSystemError("BadResource", "readFileString", targetPath));
        }

        return yield* Effect.fail(makeSystemError("NotFound", "readFileString", targetPath));
      }),

    writeFileString: (targetPath, data) =>
      Effect.gen(function* () {
        const forced = config.writeFileErrors?.[targetPath];
        if (forced) {
          return yield* Effect.fail(makeSystemError(forced, "writeFileString", targetPath));
        }

        store[targetPath] = data;
      }),

    rename: (oldPath, newPath) =>
      Effect.gen(function* () {
        const forced = config.renameErrors?.[oldPath];
        if (forced) {
          return yield* Effect.fail(makeSystemError(forced, "rename", oldPath));
        }

        const content = store[oldPath];
        if (content === undefined) {
          return yield* Effect.fail(makeSystemError("NotFound", "rename", oldPath));
        }

        store[newPath] = content;
        delete store[oldPath];
      }),

    remove: (targetPath) =>
      Effect.gen(function* () {
        delete store[targetPath];
      }),

    readLink: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.readLinkErrors?.[targetPath];
        if (forced) {
          return yield* Effect.fail(makeSystemError(forced, "readLink", targetPath));
        }

        const target = config.symlinkTargets?.[targetPath];
        if (target !== undefined) {
          return target;
        }

        if (config.entryTypes[targetPath]) {
          return yield* Effect.fail(makeSystemError("BadResource", "readLink", targetPath));
        }

        return yield* Effect.fail(makeSystemError("NotFound", "readLink", targetPath));
      }),

    stat: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.statErrors?.[targetPath];
        if (forced) {
          return yield* Effect.fail(makeSystemError(forced, "stat", targetPath));
        }

        const type = config.entryTypes[targetPath];
        if (!type) {
          return yield* Effect.fail(makeSystemError("NotFound", "stat", targetPath));
        }

        return makeFileInfo(type);
      }),
  });

  return { layer, store };
};

export const createMockFileSystemLayer = (
  config: MockFileSystemConfig,
): Layer.Layer<FileSystem.FileSystem> => createMockFileSystem(config).layer;
