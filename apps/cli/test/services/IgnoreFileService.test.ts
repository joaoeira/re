import { Effect, Layer } from "effect";
import { describe, it, assert } from "@effect/vitest";
import { FileSystem, Path } from "@effect/platform";
import {
  IgnoreFileService,
  IgnoreFileServiceLive,
  parseIgnoreFile,
} from "../../src/services/IgnoreFileService";

describe("parseIgnoreFile", () => {
  it("parses simple file with one entry per line", () => {
    const content = `todo.md
drafts.md
scratch.md`;
    const result = parseIgnoreFile(content);

    assert.strictEqual(result.size, 3);
    assert.ok(result.has("todo.md"));
    assert.ok(result.has("drafts.md"));
    assert.ok(result.has("scratch.md"));
  });

  it("ignores empty lines", () => {
    const content = `todo.md

drafts.md

`;
    const result = parseIgnoreFile(content);

    assert.strictEqual(result.size, 2);
    assert.ok(result.has("todo.md"));
    assert.ok(result.has("drafts.md"));
  });

  it("ignores comment lines starting with #", () => {
    const content = `# This is a comment
todo.md
# Another comment
drafts.md`;
    const result = parseIgnoreFile(content);

    assert.strictEqual(result.size, 2);
    assert.ok(result.has("todo.md"));
    assert.ok(result.has("drafts.md"));
    assert.ok(!result.has("# This is a comment"));
  });

  it("trims whitespace from entries", () => {
    const content = `  todo.md
	drafts.md	`;
    const result = parseIgnoreFile(content);

    assert.strictEqual(result.size, 2);
    assert.ok(result.has("todo.md"));
    assert.ok(result.has("drafts.md"));
  });

  it("handles empty content", () => {
    const result = parseIgnoreFile("");
    assert.strictEqual(result.size, 0);
  });

  it("handles content with only comments and whitespace", () => {
    const content = `# Comment 1

# Comment 2
  `;
    const result = parseIgnoreFile(content);
    assert.strictEqual(result.size, 0);
  });
});

describe("IgnoreFileService", () => {
  // Create a mock FileSystem for testing
  const createMockFileSystem = (files: Record<string, string>) =>
    Layer.succeed(FileSystem.FileSystem, {
      readFileString: (path: string) =>
        Effect.gen(function* () {
          const content = files[path];
          if (content === undefined) {
            return yield* Effect.fail({ _tag: "SystemError" as const, message: "File not found" });
          }
          return content;
        }),
      // Stub out other methods (not used in tests)
      readDirectory: () => Effect.succeed([]),
      access: () => Effect.succeed(void 0),
      copy: () => Effect.succeed(void 0),
      copyFile: () => Effect.succeed(void 0),
      chmod: () => Effect.succeed(void 0),
      chown: () => Effect.succeed(void 0),
      exists: () => Effect.succeed(true),
      link: () => Effect.succeed(void 0),
      makeDirectory: () => Effect.succeed(void 0),
      makeTempDirectory: () => Effect.succeed(""),
      makeTempDirectoryScoped: () => Effect.succeed(""),
      makeTempFile: () => Effect.succeed(""),
      makeTempFileScoped: () => Effect.succeed(""),
      open: () => Effect.succeed({} as any),
      readFile: () => Effect.succeed(new Uint8Array()),
      readLink: () => Effect.succeed(""),
      realPath: () => Effect.succeed(""),
      remove: () => Effect.succeed(void 0),
      rename: () => Effect.succeed(void 0),
      sink: () => ({}) as any,
      stat: () => Effect.succeed({} as any),
      stream: () => ({}) as any,
      symlink: () => Effect.succeed(void 0),
      truncate: () => Effect.succeed(void 0),
      utimes: () => Effect.succeed(void 0),
      watch: () => ({}) as any,
      writeFile: () => Effect.succeed(void 0),
      writeFileString: () => Effect.succeed(void 0),
    } as FileSystem.FileSystem);

  it.effect("builds ignore map from .reignore files", () =>
    Effect.gen(function* () {
      const service = yield* IgnoreFileService;
      const entries = [".reignore", "deck1.md", "subdir/.reignore", "subdir/deck2.md"];
      const ignoreMap = yield* service.buildIgnoreMap("/root", entries);

      // Root directory ignores
      assert.ok(ignoreMap.isIgnored("todo.md"));
      assert.ok(ignoreMap.isIgnored("drafts.md"));
      assert.ok(!ignoreMap.isIgnored("deck1.md"));

      // Subdir ignores
      assert.ok(ignoreMap.isIgnored("subdir/scratch.md"));
      assert.ok(!ignoreMap.isIgnored("subdir/deck2.md"));

      // Cross-directory: root ignore doesn't affect subdir
      assert.ok(!ignoreMap.isIgnored("subdir/todo.md"));
    }).pipe(
      Effect.provide(IgnoreFileServiceLive),
      Effect.provide(Path.layer),
      Effect.provide(
        createMockFileSystem({
          "/root/.reignore": "todo.md\ndrafts.md",
          "/root/subdir/.reignore": "scratch.md",
        }),
      ),
    ),
  );

  it.effect("returns empty ignore map when no .reignore files exist", () =>
    Effect.gen(function* () {
      const service = yield* IgnoreFileService;
      const entries = ["deck1.md", "subdir/deck2.md"];
      const ignoreMap = yield* service.buildIgnoreMap("/root", entries);

      assert.ok(!ignoreMap.isIgnored("deck1.md"));
      assert.ok(!ignoreMap.isIgnored("subdir/deck2.md"));
    }).pipe(
      Effect.provide(IgnoreFileServiceLive),
      Effect.provide(Path.layer),
      Effect.provide(createMockFileSystem({})),
    ),
  );

  it.effect("handles unreadable .reignore files gracefully", () =>
    Effect.gen(function* () {
      const service = yield* IgnoreFileService;
      // .reignore exists in entries but file doesn't exist in mock FS
      const entries = [".reignore", "deck1.md"];
      const ignoreMap = yield* service.buildIgnoreMap("/root", entries);

      // Should not crash, just not ignore anything
      assert.ok(!ignoreMap.isIgnored("deck1.md"));
    }).pipe(
      Effect.provide(IgnoreFileServiceLive),
      Effect.provide(Path.layer),
      Effect.provide(createMockFileSystem({})), // No files means .reignore read will fail
    ),
  );

  it.effect("handles nested directories correctly", () =>
    Effect.gen(function* () {
      const service = yield* IgnoreFileService;
      const entries = ["a/b/c/.reignore", "a/b/c/ignored.md", "a/b/c/kept.md"];
      const ignoreMap = yield* service.buildIgnoreMap("/root", entries);

      assert.ok(ignoreMap.isIgnored("a/b/c/ignored.md"));
      assert.ok(!ignoreMap.isIgnored("a/b/c/kept.md"));
      // Different directory
      assert.ok(!ignoreMap.isIgnored("a/b/ignored.md"));
    }).pipe(
      Effect.provide(IgnoreFileServiceLive),
      Effect.provide(Path.layer),
      Effect.provide(
        createMockFileSystem({
          "/root/a/b/c/.reignore": "ignored.md",
        }),
      ),
    ),
  );
});
