import { FileSystem } from "@effect/platform";
import { SystemError, type SystemErrorReason } from "@effect/platform/Error";
import { Effect, Layer, Option } from "effect";

export interface MockFileSystemConfig {
  readonly entryTypes: Record<string, FileSystem.File.Type>;
  readonly directories: Record<string, readonly string[]>;
  readonly fileContents?: Record<string, string>;
  readonly fileBytes?: Record<string, Uint8Array>;
  readonly symlinkTargets?: Record<string, string>;
  readonly readDirectoryErrors?: Record<string, SystemErrorReason>;
  readonly statErrors?: Record<string, SystemErrorReason>;
  readonly readFileErrors?: Record<string, SystemErrorReason>;
  readonly readLinkErrors?: Record<string, SystemErrorReason>;
  readonly writeFileErrors?: Record<string, SystemErrorReason>;
  readonly renameErrors?: Record<string, SystemErrorReason>;
  readonly removeErrors?: Record<string, SystemErrorReason>;
  readonly makeDirectoryErrors?: Record<string, SystemErrorReason>;
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
  readonly bytesStore: Record<string, Uint8Array>;
}

export const createMockFileSystem = (config: MockFileSystemConfig): MockFileSystem => {
  const entryTypes: Record<string, FileSystem.File.Type> = { ...config.entryTypes };
  const store: Record<string, string> = { ...config.fileContents };
  const bytesStore: Record<string, Uint8Array> = { ...config.fileBytes };
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const layer = FileSystem.layerNoop({
    readDirectory: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.readDirectoryErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "readDirectory", targetPath);
        }

        const entries = config.directories[targetPath];
        if (entries) {
          return [...entries];
        }

        if (entryTypes[targetPath]) {
          return yield* makeSystemError("BadResource", "readDirectory", targetPath);
        }

        return yield* makeSystemError("NotFound", "readDirectory", targetPath);
      }),

    readFile: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.readFileErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "readFile", targetPath);
        }

        const bytes = bytesStore[targetPath];
        if (bytes !== undefined) {
          return bytes;
        }

        const content = store[targetPath];
        if (content !== undefined) {
          return textEncoder.encode(content);
        }

        if (entryTypes[targetPath]) {
          return yield* makeSystemError("BadResource", "readFile", targetPath);
        }

        return yield* makeSystemError("NotFound", "readFile", targetPath);
      }),

    readFileString: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.readFileErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "readFileString", targetPath);
        }

        const bytes = bytesStore[targetPath];
        if (bytes !== undefined) {
          return textDecoder.decode(bytes);
        }

        const content = store[targetPath];
        if (content !== undefined) {
          return content;
        }

        if (entryTypes[targetPath]) {
          return yield* makeSystemError("BadResource", "readFileString", targetPath);
        }

        return yield* makeSystemError("NotFound", "readFileString", targetPath);
      }),

    writeFile: (targetPath, data, options) =>
      Effect.gen(function* () {
        const forced = config.writeFileErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "writeFile", targetPath);
        }

        if (options?.flag === "wx") {
          if (
            store[targetPath] !== undefined ||
            bytesStore[targetPath] !== undefined ||
            entryTypes[targetPath] !== undefined
          ) {
            return yield* makeSystemError("AlreadyExists", "writeFile", targetPath);
          }
        }

        bytesStore[targetPath] = data;
        entryTypes[targetPath] = "File";
      }),

    writeFileString: (targetPath, data, options) =>
      Effect.gen(function* () {
        const forced = config.writeFileErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "writeFileString", targetPath);
        }

        if (options?.flag === "wx") {
          if (
            store[targetPath] !== undefined ||
            bytesStore[targetPath] !== undefined ||
            entryTypes[targetPath] !== undefined
          ) {
            return yield* makeSystemError("AlreadyExists", "writeFileString", targetPath);
          }
        }

        store[targetPath] = data;
        entryTypes[targetPath] = "File";
      }),

    makeDirectory: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.makeDirectoryErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "makeDirectory", targetPath);
        }
      }),

    rename: (oldPath, newPath) =>
      Effect.gen(function* () {
        const forced = config.renameErrors?.[oldPath];
        if (forced) {
          return yield* makeSystemError(forced, "rename", oldPath);
        }

        const content = store[oldPath];
        const bytes = bytesStore[oldPath];
        if (content === undefined && bytes === undefined) {
          return yield* makeSystemError("NotFound", "rename", oldPath);
        }

        if (content !== undefined) {
          store[newPath] = content;
          delete store[oldPath];
        }

        if (bytes !== undefined) {
          bytesStore[newPath] = bytes;
          delete bytesStore[oldPath];
        }

        entryTypes[newPath] = entryTypes[oldPath] ?? "File";
        delete entryTypes[oldPath];
      }),

    remove: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.removeErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "remove", targetPath);
        }

        delete store[targetPath];
        delete bytesStore[targetPath];
        delete entryTypes[targetPath];
      }),

    readLink: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.readLinkErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "readLink", targetPath);
        }

        const target = config.symlinkTargets?.[targetPath];
        if (target !== undefined) {
          return target;
        }

        if (entryTypes[targetPath]) {
          return yield* makeSystemError("BadResource", "readLink", targetPath);
        }

        return yield* makeSystemError("NotFound", "readLink", targetPath);
      }),

    stat: (targetPath) =>
      Effect.gen(function* () {
        const forced = config.statErrors?.[targetPath];
        if (forced) {
          return yield* makeSystemError(forced, "stat", targetPath);
        }

        const type = entryTypes[targetPath];
        if (!type) {
          return yield* makeSystemError("NotFound", "stat", targetPath);
        }

        return makeFileInfo(type);
      }),
  });

  return { layer, store, bytesStore };
};

export const createMockFileSystemLayer = (
  config: MockFileSystemConfig,
): Layer.Layer<FileSystem.FileSystem> => createMockFileSystem(config).layer;
