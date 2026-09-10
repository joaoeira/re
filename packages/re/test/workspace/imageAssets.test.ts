import * as Path from "effect/Path";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import { Effect, Result, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  ImportDeckImageAssetOperationError,
  InvalidWorkspaceImageAsset,
  WORKSPACE_IMAGE_ASSETS_RELATIVE_PATH,
  getWorkspaceImageAssetsDirectory,
  importDeckImageAsset,
  importDeckImageAssetFromBytes,
} from "../../src/workspace/index.js";
import { createMockFileSystem, type MockFileSystemConfig } from "./mock-file-system";

const buildLayer = (config: MockFileSystemConfig) => {
  const mock = createMockFileSystem(config);

  return {
    mock,
    layer: Layer.merge(mock.layer, Path.layer),
  };
};

const runGetAssetsDirectory = (rootPath: string) =>
  getWorkspaceImageAssetsDirectory(rootPath).pipe(Effect.provide(Path.layer), Effect.runPromise);

const runGetAssetsDirectoryResult = (rootPath: string) =>
  getWorkspaceImageAssetsDirectory(rootPath).pipe(
    Effect.result,
    Effect.provide(Path.layer),
    Effect.runPromise,
  );

const runImport = (
  config: MockFileSystemConfig,
  options: Parameters<typeof importDeckImageAsset>[0],
) => {
  const { mock, layer } = buildLayer(config);

  return {
    mock,
    promise: importDeckImageAsset(options).pipe(Effect.provide(layer), Effect.runPromise),
  };
};

const runImportResult = (
  config: MockFileSystemConfig,
  options: Parameters<typeof importDeckImageAsset>[0],
) => {
  const { mock, layer } = buildLayer(config);

  return {
    mock,
    promise: importDeckImageAsset(options).pipe(
      Effect.result,
      Effect.provide(layer),
      Effect.runPromise,
    ),
  };
};

const runImportFromBytes = (
  config: MockFileSystemConfig,
  options: Parameters<typeof importDeckImageAssetFromBytes>[0],
) => {
  const { mock, layer } = buildLayer(config);

  return {
    mock,
    promise: importDeckImageAssetFromBytes(options).pipe(Effect.provide(layer), Effect.runPromise),
  };
};

const runImportFromBytesResult = (
  config: MockFileSystemConfig,
  options: Parameters<typeof importDeckImageAssetFromBytes>[0],
) => {
  const { mock, layer } = buildLayer(config);

  return {
    mock,
    promise: importDeckImageAssetFromBytes(options).pipe(
      Effect.result,
      Effect.provide(layer),
      Effect.runPromise,
    ),
  };
};

describe("imageAssets", () => {
  describe("getWorkspaceImageAssetsDirectory", () => {
    it("returns the canonical hidden assets directory under the workspace root", async () => {
      const result = await runGetAssetsDirectory("/workspace");
      expect(result).toBe("/workspace/.re/assets");
      expect(WORKSPACE_IMAGE_ASSETS_RELATIVE_PATH).toBe(".re/assets");
    });

    it("rejects relative workspace roots", async () => {
      const result = await runGetAssetsDirectoryResult("workspace");
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(InvalidWorkspaceImageAsset);
        expect(result.failure.reason).toBe("absolute_root_path_required");
      }
    });
  });

  describe("importDeckImageAsset", () => {
    it("imports an image into the canonical store and returns the markdown path to write", async () => {
      const sourceBytes = new Uint8Array([1, 2, 3, 4]);

      const { mock, promise } = runImport(
        {
          entryTypes: {
            "/tmp/source.PNG": "File",
          },
          directories: {},
          fileBytes: {
            "/tmp/source.PNG": sourceBytes,
          },
        },
        {
          rootPath: "/workspace",
          deckPath: "/workspace/decks/biology/cell.md",
          sourcePath: "/tmp/source.PNG",
        },
      );

      const result = await promise;

      expect(result).toEqual({
        contentHash: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
        extension: ".png",
        absolutePath:
          "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
        workspaceRelativePath:
          ".re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
        deckRelativePath:
          "../../.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
      });

      expect(
        Array.from(
          mock.bytesStore[
            "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png"
          ] ?? [],
        ),
      ).toEqual(Array.from(sourceBytes));
    });

    it("deduplicates by content hash when the canonical asset already exists", async () => {
      const sourceBytes = new Uint8Array([1, 2, 3, 4]);

      const assetPath =
        "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png";

      const { mock, promise } = runImport(
        {
          entryTypes: {
            "/tmp/source.png": "File",
          },
          directories: {},
          fileBytes: {
            "/tmp/source.png": sourceBytes,
            [assetPath]: sourceBytes,
          },
        },
        {
          rootPath: "/workspace",
          deckPath: "/workspace/decks/biology/cell.md",
          sourcePath: "/tmp/source.png",
        },
      );

      const result = await promise;

      expect(result.absolutePath).toBe(assetPath);
      expect(Object.keys(mock.bytesStore).filter((path) => path === assetPath)).toHaveLength(1);
    });

    it("rejects source paths without a file extension", async () => {
      const { promise } = runImportResult(
        {
          entryTypes: {
            "/tmp/source": "File",
          },
          directories: {},
          fileBytes: {
            "/tmp/source": new Uint8Array([1, 2, 3, 4]),
          },
        },
        {
          rootPath: "/workspace",
          deckPath: "/workspace/decks/biology/cell.md",
          sourcePath: "/tmp/source",
        },
      );

      const result = await promise;
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(InvalidWorkspaceImageAsset);

        if (result.failure instanceof InvalidWorkspaceImageAsset) {
          expect(result.failure.reason).toBe("missing_file_extension");
        }
      }
    });

    it("rejects decks outside the workspace root", async () => {
      const { promise } = runImportResult(
        {
          entryTypes: {
            "/tmp/source.png": "File",
          },
          directories: {},
          fileBytes: {
            "/tmp/source.png": new Uint8Array([1, 2, 3, 4]),
          },
        },
        {
          rootPath: "/workspace",
          deckPath: "/outside/decks/biology/cell.md",
          sourcePath: "/tmp/source.png",
        },
      );

      const result = await promise;
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(InvalidWorkspaceImageAsset);

        if (result.failure instanceof InvalidWorkspaceImageAsset) {
          expect(result.failure.reason).toBe("deck_outside_root");
        }
      }
    });

    it("maps source read failures to a typed operation error", async () => {
      const { promise } = runImportResult(
        {
          entryTypes: {},
          directories: {},
          readFileErrors: {
            "/tmp/missing.png": "NotFound",
          },
        },
        {
          rootPath: "/workspace",
          deckPath: "/workspace/decks/biology/cell.md",
          sourcePath: "/tmp/missing.png",
        },
      );

      const result = await promise;
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ImportDeckImageAssetOperationError);

        if (result.failure instanceof ImportDeckImageAssetOperationError) {
          expect(result.failure.operation).toBe("read_source");
          expect(result.failure.sourcePath).toBe("/tmp/missing.png");
        }
      }
    });

    it("maps non-AlreadyExists write failures to a typed operation error", async () => {
      const assetPath =
        "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png";

      const { promise } = runImportResult(
        {
          entryTypes: {
            "/tmp/source.png": "File",
          },
          directories: {},
          fileBytes: {
            "/tmp/source.png": new Uint8Array([1, 2, 3, 4]),
          },
          writeFileErrors: {
            [assetPath]: "PermissionDenied",
          },
        },
        {
          rootPath: "/workspace",
          deckPath: "/workspace/decks/biology/cell.md",
          sourcePath: "/tmp/source.png",
        },
      );

      const result = await promise;
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ImportDeckImageAssetOperationError);

        if (result.failure instanceof ImportDeckImageAssetOperationError) {
          expect(result.failure.operation).toBe("write_asset");
          expect(result.failure.assetPath).toBe(assetPath);
        }
      }
    });
  });

  describe("importDeckImageAssetFromBytes", () => {
    it("preserves hash failure messages and leaves the asset store untouched", async () => {
      const failures = [
        [new Error("Hashing unavailable"), "Hashing unavailable"],
        [{ message: "Digest rejected" }, "Digest rejected"],
        ["Digest unavailable", "Digest unavailable"],
      ] as const;

      for (const [cause, message] of failures) {
        const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(cause);

        try {
          const { mock, promise } = runImportFromBytesResult(
            { entryTypes: {}, directories: {} },
            {
              rootPath: "/workspace",
              deckPath: "/workspace/deck.md",
              bytes: new Uint8Array([1, 2, 3, 4]),
              extension: ".png",
            },
          );

          const result = await promise;
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: {
              _tag: "ImportDeckImageAssetOperationError",
              operation: "hash_source",
              message,
            },
          });
          expect(mock.bytesStore).toEqual({});

          if (Result.isFailure(result)) {
            expect(result.failure).not.toHaveProperty("sourcePath");
          }
        } finally {
          digest.mockRestore();
        }
      }
    });

    it("reports a bad write argument as a failed import rather than a deduplicated asset", async () => {
      const mock = createMockFileSystem({ entryTypes: {}, directories: {} });

      const failure = PlatformError.badArgument({
        module: "FileSystem",
        method: "writeFile",
        description: "Invalid write flag",
      });

      const result = await Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        return yield* importDeckImageAssetFromBytes({
          rootPath: "/workspace",
          deckPath: "/workspace/deck.md",
          bytes: new Uint8Array([1, 2, 3, 4]),
          extension: ".png",
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fs,
            writeFile: () => Effect.fail(failure),
          }),
          Effect.result,
        );
      }).pipe(Effect.provide(Layer.merge(mock.layer, Path.layer)), Effect.runPromise);

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "ImportDeckImageAssetOperationError",
          operation: "write_asset",
          message: failure.message,
          assetPath:
            "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
        },
      });
      expect(Object.keys(mock.bytesStore)).toEqual([]);
    });

    it("imports bytes into the canonical store and returns the markdown path to write", async () => {
      const sourceBytes = new Uint8Array([1, 2, 3, 4]);

      const { mock, promise } = runImportFromBytes(
        {
          entryTypes: {},
          directories: {},
        },
        {
          rootPath: "/workspace",
          deckPath: "/workspace/decks/biology/cell.md",
          bytes: sourceBytes,
          extension: ".PNG",
        },
      );

      const result = await promise;

      expect(result).toEqual({
        contentHash: "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a",
        extension: ".png",
        absolutePath:
          "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
        workspaceRelativePath:
          ".re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
        deckRelativePath:
          "../../.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
      });

      expect(
        Array.from(
          mock.bytesStore[
            "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png"
          ] ?? [],
        ),
      ).toEqual(Array.from(sourceBytes));
    });

    it("rejects unsupported extensions", async () => {
      const { promise } = runImportFromBytesResult(
        {
          entryTypes: {},
          directories: {},
        },
        {
          rootPath: "/workspace",
          deckPath: "/workspace/decks/biology/cell.md",
          bytes: new Uint8Array([1, 2, 3, 4]),
          extension: ".bmp",
        },
      );

      const result = await promise;
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(InvalidWorkspaceImageAsset);

        if (result.failure instanceof InvalidWorkspaceImageAsset) {
          expect(result.failure.reason).toBe("unsupported_file_extension");
        }
      }
    });
  });
});
