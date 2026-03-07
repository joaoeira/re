import { Path } from "@effect/platform";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  ImportDeckImageAssetOperationError,
  InvalidWorkspaceImageAsset,
  WORKSPACE_IMAGE_ASSETS_RELATIVE_PATH,
  getWorkspaceImageAssetsDirectory,
  importDeckImageAsset,
  importDeckImageAssetFromBytes,
} from "../src";
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

const runGetAssetsDirectoryEither = (rootPath: string) =>
  getWorkspaceImageAssetsDirectory(rootPath).pipe(
    Effect.either,
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

const runImportEither = (
  config: MockFileSystemConfig,
  options: Parameters<typeof importDeckImageAsset>[0],
) => {
  const { mock, layer } = buildLayer(config);
  return {
    mock,
    promise: importDeckImageAsset(options).pipe(
      Effect.either,
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

const runImportFromBytesEither = (
  config: MockFileSystemConfig,
  options: Parameters<typeof importDeckImageAssetFromBytes>[0],
) => {
  const { mock, layer } = buildLayer(config);
  return {
    mock,
    promise: importDeckImageAssetFromBytes(options).pipe(
      Effect.either,
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
      const result = await runGetAssetsDirectoryEither("workspace");
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(InvalidWorkspaceImageAsset);
        expect(result.left.reason).toBe("absolute_root_path_required");
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
      const { promise } = runImportEither(
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
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(InvalidWorkspaceImageAsset);
        if (result.left instanceof InvalidWorkspaceImageAsset) {
          expect(result.left.reason).toBe("missing_file_extension");
        }
      }
    });

    it("rejects decks outside the workspace root", async () => {
      const { promise } = runImportEither(
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
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(InvalidWorkspaceImageAsset);
        if (result.left instanceof InvalidWorkspaceImageAsset) {
          expect(result.left.reason).toBe("deck_outside_root");
        }
      }
    });

    it("maps source read failures to a typed operation error", async () => {
      const { promise } = runImportEither(
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
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ImportDeckImageAssetOperationError);
        if (result.left instanceof ImportDeckImageAssetOperationError) {
          expect(result.left.operation).toBe("read_source");
          expect(result.left.sourcePath).toBe("/tmp/missing.png");
        }
      }
    });

    it("maps non-AlreadyExists write failures to a typed operation error", async () => {
      const assetPath =
        "/workspace/.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png";
      const { promise } = runImportEither(
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
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(ImportDeckImageAssetOperationError);
        if (result.left instanceof ImportDeckImageAssetOperationError) {
          expect(result.left.operation).toBe("write_asset");
          expect(result.left.assetPath).toBe(assetPath);
        }
      }
    });
  });

  describe("importDeckImageAssetFromBytes", () => {
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
      const { promise } = runImportFromBytesEither(
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
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(InvalidWorkspaceImageAsset);
        if (result.left instanceof InvalidWorkspaceImageAsset) {
          expect(result.left.reason).toBe("unsupported_file_extension");
        }
      }
    });
  });
});
