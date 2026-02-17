import { Path } from "@effect/platform";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  scanDecks,
  WorkspaceRootNotDirectory,
  WorkspaceRootNotFound,
  WorkspaceRootUnreadable,
} from "../src";
import {
  createMockFileSystemLayer,
  type MockFileSystemConfig,
} from "./mock-file-system";

const runScan = (
  rootPath: string,
  config: MockFileSystemConfig,
  options?: Parameters<typeof scanDecks>[1]
) =>
  scanDecks(rootPath, options).pipe(
    Effect.provide(Layer.merge(createMockFileSystemLayer(config), Path.layer)),
    Effect.runPromise
  );

const runScanEither = (
  rootPath: string,
  config: MockFileSystemConfig,
  options?: Parameters<typeof scanDecks>[1]
) =>
  scanDecks(rootPath, options).pipe(
    Effect.either,
    Effect.provide(Layer.merge(createMockFileSystemLayer(config), Path.layer)),
    Effect.runPromise
  );

describe("scanDecks", () => {
  it("returns WorkspaceRootNotFound for missing roots", async () => {
    const result = await runScanEither("/root", {
      entryTypes: {},
      directories: {},
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(WorkspaceRootNotFound);
      expect(result.left.rootPath).toBe("/root");
    }
  });

  it("returns WorkspaceRootNotDirectory for non-directory roots", async () => {
    const result = await runScanEither("/root/file.md", {
      entryTypes: {
        "/root/file.md": "File",
      },
      directories: {},
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(WorkspaceRootNotDirectory);
      expect(result.left.rootPath).toBe("/root/file.md");
    }
  });

  it("returns WorkspaceRootUnreadable when root directory cannot be listed", async () => {
    const result = await runScanEither("/root", {
      entryTypes: {
        "/root": "Directory",
      },
      directories: {
        "/root": [],
      },
      readDirectoryErrors: {
        "/root": "PermissionDenied",
      },
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(WorkspaceRootUnreadable);
      expect(result.left.rootPath).toBe("/root");
    }
  });

  it("discovers only markdown files and returns deterministic ordering", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/zeta.md": "File",
        "/root/nested": "Directory",
        "/root/nested/alpha.md": "File",
        "/root/nested/beta.md": "File",
        "/root/nested/not-a-deck.txt": "File",
        "/root/gamma.markdown": "File",
      },
      directories: {
        "/root": ["zeta.md", "nested", "gamma.markdown"],
        "/root/nested": ["beta.md", "alpha.md", "not-a-deck.txt"],
      },
    });

    expect(result.rootPath).toBe("/root");
    expect(result.decks.map((deck) => deck.relativePath)).toEqual([
      "nested/alpha.md",
      "nested/beta.md",
      "zeta.md",
    ]);
    expect(result.decks.map((deck) => deck.name)).toEqual([
      "alpha",
      "beta",
      "zeta",
    ]);
  });

  it("excludes hidden files and directories by default", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/visible.md": "File",
        "/root/.hidden": "Directory",
        "/root/.hidden/secret.md": "File",
        "/root/nested": "Directory",
        "/root/nested/.private.md": "File",
      },
      directories: {
        "/root": ["visible.md", ".hidden", "nested"],
        "/root/.hidden": ["secret.md"],
        "/root/nested": [".private.md"],
      },
    });

    expect(result.decks.map((deck) => deck.relativePath)).toEqual(["visible.md"]);
  });

  it("includes hidden files and directories when includeHidden is true", async () => {
    const result = await runScan(
      "/root",
      {
        entryTypes: {
          "/root": "Directory",
          "/root/visible.md": "File",
          "/root/.hidden": "Directory",
          "/root/.hidden/secret.md": "File",
          "/root/nested": "Directory",
          "/root/nested/.private.md": "File",
        },
        directories: {
          "/root": ["visible.md", ".hidden", "nested"],
          "/root/.hidden": ["secret.md"],
          "/root/nested": [".private.md"],
        },
      },
      { includeHidden: true }
    );

    expect(result.decks.map((deck) => deck.relativePath)).toEqual([
      ".hidden/secret.md",
      "nested/.private.md",
      "visible.md",
    ]);
  });

  it("applies root .reignore patterns for file and directory ignores", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/.reignore": "File",
        "/root/ignored.md": "File",
        "/root/drafts": "Directory",
        "/root/drafts/first.md": "File",
        "/root/temp-file.tmp.md": "File",
        "/root/kept.md": "File",
      },
      directories: {
        "/root": [
          ".reignore",
          "ignored.md",
          "drafts",
          "temp-file.tmp.md",
          "kept.md",
        ],
        "/root/drafts": ["first.md"],
      },
      fileContents: {
        "/root/.reignore": ["ignored.md", "drafts/", "*.tmp.md"].join("\n"),
      },
    });

    expect(result.decks.map((deck) => deck.relativePath)).toEqual(["kept.md"]);
  });

  it("applies extraIgnorePatterns using gitignore semantics", async () => {
    const result = await runScan(
      "/root",
      {
        entryTypes: {
          "/root": "Directory",
          "/root/a.md": "File",
          "/root/b.md": "File",
          "/root/keep.md": "File",
        },
        directories: {
          "/root": ["a.md", "b.md", "keep.md"],
        },
      },
      {
        extraIgnorePatterns: ["*.md", "!keep.md"],
      }
    );

    expect(result.decks.map((deck) => deck.relativePath)).toEqual(["keep.md"]);
  });

  it("ignores nested .reignore files", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/nested": "Directory",
        "/root/nested/deck.md": "File",
        "/root/nested/.reignore": "File",
      },
      directories: {
        "/root": ["nested"],
        "/root/nested": ["deck.md", ".reignore"],
      },
      fileContents: {
        "/root/nested/.reignore": "deck.md\n",
      },
    });

    expect(result.decks.map((deck) => deck.relativePath)).toEqual(["nested/deck.md"]);
  });

  it("skips unreadable nested directories without failing", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/good.md": "File",
        "/root/blocked": "Directory",
        "/root/blocked/inside.md": "File",
        "/root/blocked-file.md": "File",
      },
      directories: {
        "/root": ["good.md", "blocked", "blocked-file.md"],
        "/root/blocked": ["inside.md"],
      },
      readDirectoryErrors: {
        "/root/blocked": "PermissionDenied",
      },
    });

    expect(result.decks.map((deck) => deck.relativePath)).toEqual([
      "blocked-file.md",
      "good.md",
    ]);
  });

  it("fails on unexpected nested directory errors", async () => {
    const result = await runScanEither("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/good.md": "File",
        "/root/broken": "Directory",
      },
      directories: {
        "/root": ["good.md", "broken"],
        "/root/broken": [],
      },
      readDirectoryErrors: {
        "/root/broken": "Unknown",
      },
    });

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(WorkspaceRootUnreadable);
      expect(result.left.message).toContain("readDirectory failed for /root/broken");
    }
  });

  it("skips symbolic links instead of following them", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/real": "Directory",
        "/root/real/inside.md": "File",
        "/root/real-file.md": "File",
        "/root/linked-dir": "SymbolicLink",
        "/root/linked-file.md": "SymbolicLink",
      },
      directories: {
        "/root": ["real", "real-file.md", "linked-dir", "linked-file.md"],
        "/root/real": ["inside.md"],
      },
      symlinkTargets: {
        "/root/linked-dir": "/root/real",
        "/root/linked-file.md": "/root/real-file.md",
      },
    });

    expect(result.decks.map((deck) => deck.relativePath)).toEqual([
      "real-file.md",
      "real/inside.md",
    ]);
  });

  it("continues when root .reignore cannot be read", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/deck.md": "File",
        "/root/.reignore": "File",
      },
      directories: {
        "/root": ["deck.md", ".reignore"],
      },
      readFileErrors: {
        "/root/.reignore": "PermissionDenied",
      },
    });

    expect(result.decks.map((deck) => deck.relativePath)).toEqual(["deck.md"]);
  });

  it("returns root-relative paths with POSIX separators", async () => {
    const result = await runScan("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/a": "Directory",
        "/root/a/b": "Directory",
        "/root/a/b/deck.md": "File",
      },
      directories: {
        "/root": ["a"],
        "/root/a": ["b"],
        "/root/a/b": ["deck.md"],
      },
    });

    expect(result.decks[0]?.relativePath).toBe("a/b/deck.md");
  });
});
