import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { DeckDiscovery, DeckDiscoveryLive } from "../../src/services/DeckDiscovery";
import { IgnoreFileService } from "../../src/services/IgnoreFileService";

// Mock FileSystem using @effect/platform's layerNoop
const MockFileSystem = FileSystem.layerNoop({
  readDirectory: (path) => {
    const mockFiles: Record<string, string[]> = {
      "/root": [
        "folder1",
        "folder2",
        "deck.md",
        ".hidden/secret.md",
        "folder1/chapter1.md",
        "folder1/chapter2.md",
      ],
    };
    if (path in mockFiles) return Effect.succeed(mockFiles[path]!);
    return Effect.fail(
      new SystemError({
        reason: "NotFound",
        module: "FileSystem",
        method: "readDirectory",
        pathOrDescriptor: path,
      }),
    );
  },
});

// Mock IgnoreFileService that ignores nothing
const MockIgnoreFileService = Layer.succeed(IgnoreFileService, {
  buildIgnoreMap: () =>
    Effect.succeed({
      isIgnored: () => false,
    }),
});

const TestLayer = DeckDiscoveryLive.pipe(
  Layer.provide(MockIgnoreFileService),
  Layer.provide(Layer.mergeAll(MockFileSystem, Path.layer)),
);

describe("DeckDiscovery", () => {
  it("discovers markdown files and excludes hidden directories", async () => {
    const result = await Effect.gen(function* () {
      const discovery = yield* DeckDiscovery;
      return yield* discovery.discoverDecks("/root");
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result.error).toBeNull();
    expect(result.paths).toContain("/root/deck.md");
    expect(result.paths).toContain("/root/folder1/chapter1.md");
    expect(result.paths).toContain("/root/folder1/chapter2.md");
    expect(result.paths).not.toContain("/root/.hidden/secret.md");
  });

  it("returns error when directory cannot be read", async () => {
    const result = await Effect.gen(function* () {
      const discovery = yield* DeckDiscovery;
      return yield* discovery.discoverDecks("/nonexistent");
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result.error).toContain("Failed to read directory");
    expect(result.paths).toEqual([]);
  });
});
