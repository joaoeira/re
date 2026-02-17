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

export const createMockFileSystemLayer = (
  config: MockFileSystemConfig,
): Layer.Layer<FileSystem.FileSystem> =>
  FileSystem.layerNoop({
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

        const content = config.fileContents?.[targetPath];
        if (content !== undefined) {
          return content;
        }

        if (config.entryTypes[targetPath]) {
          return yield* Effect.fail(makeSystemError("BadResource", "readFileString", targetPath));
        }

        return yield* Effect.fail(makeSystemError("NotFound", "readFileString", targetPath));
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
