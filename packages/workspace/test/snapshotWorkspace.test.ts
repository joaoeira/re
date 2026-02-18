import { Path } from "@effect/platform";
import { ParseError } from "@re/core";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { snapshotWorkspace, WorkspaceRootNotDirectory, WorkspaceRootNotFound } from "../src";
import { formatMetadataParseError } from "../src/snapshotWorkspace";
import { createMockFileSystemLayer, type MockFileSystemConfig } from "./mock-file-system";

const runSnapshot = (
  rootPath: string,
  config: MockFileSystemConfig,
  options?: Parameters<typeof snapshotWorkspace>[1],
) =>
  snapshotWorkspace(rootPath, options).pipe(
    Effect.provide(Layer.merge(createMockFileSystemLayer(config), Path.layer)),
    Effect.runPromise,
  );

const runSnapshotEither = (
  rootPath: string,
  config: MockFileSystemConfig,
  options?: Parameters<typeof snapshotWorkspace>[1],
) =>
  snapshotWorkspace(rootPath, options).pipe(
    Effect.either,
    Effect.provide(Layer.merge(createMockFileSystemLayer(config), Path.layer)),
    Effect.runPromise,
  );

const makeCard = (id: string, state: 0 | 1 | 2 | 3 = 0): string => `<!--@ ${id} 0 0 ${state} 0-->
Question
---
Answer
`;

describe("snapshotWorkspace", () => {
  it("returns WorkspaceRootNotFound for missing roots", async () => {
    const result = await runSnapshotEither("/root", {
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
    const result = await runSnapshotEither("/root/file.md", {
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

  it("returns decks in deterministic relative-path order", async () => {
    const result = await runSnapshot("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/zeta.md": "File",
        "/root/nested": "Directory",
        "/root/nested/alpha.md": "File",
        "/root/nested/beta.md": "File",
      },
      directories: {
        "/root": ["zeta.md", "nested"],
        "/root/nested": ["beta.md", "alpha.md"],
      },
      fileContents: {
        "/root/zeta.md": makeCard("zeta"),
        "/root/nested/alpha.md": makeCard("alpha"),
        "/root/nested/beta.md": makeCard("beta"),
      },
    });

    expect(result.decks.map((deck) => deck.relativePath)).toEqual([
      "nested/alpha.md",
      "nested/beta.md",
      "zeta.md",
    ]);
  });

  it("maps states explicitly and aggregates mixed and multi-card items", async () => {
    const mixedDeck = `<!--@ new-a 0 0 0 0-->
New prompt
---
New answer

<!--@ learning-a 1 2 1 0 2025-01-01T00:00:00Z-->
Learning prompt
---
Learning answer

<!--@ review-a 5 4 2 0 2025-01-01T00:00:00Z-->
Review prompt
---
Review answer

<!--@ relearn-a 2 3 3 0 2025-01-01T00:00:00Z-->
Relearn prompt
---
Relearn answer

<!--@ multi-one 0 0 0 0-->
<!--@ multi-two 0 0 2 0 2025-01-01T00:00:00Z-->
Shared prompt
---
Shared answer
`;

    const result = await runSnapshot("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/mixed.md": "File",
      },
      directories: {
        "/root": ["mixed.md"],
      },
      fileContents: {
        "/root/mixed.md": mixedDeck,
      },
    });

    const deck = result.decks[0]!;
    expect(deck.status).toBe("ok");
    if (deck.status === "ok") {
      expect(deck.totalCards).toBe(6);
      expect(deck.stateCounts).toEqual({
        new: 2,
        learning: 1,
        review: 2,
        relearning: 1,
      });
    }
  });

  it("returns ok status with zero counts for empty markdown decks", async () => {
    const result = await runSnapshot("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/empty.md": "File",
      },
      directories: {
        "/root": ["empty.md"],
      },
      fileContents: {
        "/root/empty.md": "# This file has no card metadata",
      },
    });

    const deck = result.decks[0]!;
    expect(deck.status).toBe("ok");
    if (deck.status === "ok") {
      expect(deck.totalCards).toBe(0);
      expect(deck.stateCounts).toEqual({
        new: 0,
        learning: 0,
        review: 0,
        relearning: 0,
      });
    }
  });

  it("returns partial success when one deck is unreadable", async () => {
    const result = await runSnapshot("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/good.md": "File",
        "/root/blocked.md": "File",
      },
      directories: {
        "/root": ["good.md", "blocked.md"],
      },
      fileContents: {
        "/root/good.md": makeCard("good-card"),
      },
      readFileErrors: {
        "/root/blocked.md": "PermissionDenied",
      },
    });

    const blocked = result.decks.find((deck) => deck.name === "blocked");
    const good = result.decks.find((deck) => deck.name === "good");

    expect(blocked?.status).toBe("read_error");
    if (blocked?.status === "read_error") {
      expect(blocked.message).toContain("PermissionDenied");
    }

    expect(good?.status).toBe("ok");
    if (good?.status === "ok") {
      expect(good.totalCards).toBe(1);
    }
  });

  it("returns parse_error and normalizes InvalidFieldValue messages", async () => {
    const result = await runSnapshot("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/good.md": "File",
        "/root/bad-numeric.md": "File",
      },
      directories: {
        "/root": ["good.md", "bad-numeric.md"],
      },
      fileContents: {
        "/root/good.md": makeCard("good-card"),
        "/root/bad-numeric.md": `<!--@ bad invalid 0 0 0-->
Bad card`,
      },
    });

    const bad = result.decks.find((deck) => deck.name === "bad-numeric");
    const good = result.decks.find((deck) => deck.name === "good");

    expect(bad?.status).toBe("parse_error");
    if (bad?.status === "parse_error") {
      expect(bad.message).toContain("Invalid metadata at line 1: expected");
      expect(bad.message).toContain('got "bad invalid 0 0 0"');
    }

    expect(good?.status).toBe("ok");
  });

  it("returns parse_error and normalizes InvalidMetadataFormat messages", async () => {
    const result = await runSnapshot("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/bad-format.md": "File",
      },
      directories: {
        "/root": ["bad-format.md"],
      },
      fileContents: {
        "/root/bad-format.md": `<!--@ bad 0 0 0-->
Bad format card`,
      },
    });

    const bad = result.decks[0]!;
    expect(bad.status).toBe("parse_error");
    if (bad.status === "parse_error") {
      expect(bad.message).toContain("Invalid metadata at line 1: Expected 5-7 fields, got 4");
    }
  });

  it("honors includeHidden and extraIgnorePatterns options like scanDecks", async () => {
    const config: MockFileSystemConfig = {
      entryTypes: {
        "/root": "Directory",
        "/root/keep.md": "File",
        "/root/skip.md": "File",
        "/root/.hidden": "Directory",
        "/root/.hidden/secret.md": "File",
      },
      directories: {
        "/root": ["keep.md", "skip.md", ".hidden"],
        "/root/.hidden": ["secret.md"],
      },
      fileContents: {
        "/root/keep.md": makeCard("keep"),
        "/root/skip.md": makeCard("skip"),
        "/root/.hidden/secret.md": makeCard("secret"),
      },
    };

    const withoutHidden = await runSnapshot("/root", config);
    expect(withoutHidden.decks.map((deck) => deck.relativePath)).toEqual(["keep.md", "skip.md"]);

    const withHiddenAndIgnores = await runSnapshot("/root", config, {
      includeHidden: true,
      extraIgnorePatterns: ["*.md", "!keep.md", "!.hidden/secret.md"],
    });
    expect(withHiddenAndIgnores.decks.map((deck) => deck.relativePath)).toEqual([
      ".hidden/secret.md",
      "keep.md",
    ]);
  });

  it("does not expose per-card arrays in snapshot output", async () => {
    const result = await runSnapshot("/root", {
      entryTypes: {
        "/root": "Directory",
        "/root/deck.md": "File",
      },
      directories: {
        "/root": ["deck.md"],
      },
      fileContents: {
        "/root/deck.md": makeCard("card-a"),
      },
    });

    const deck = result.decks[0]!;
    expect(deck.status).toBe("ok");
    expect(Object.prototype.hasOwnProperty.call(deck, "cards")).toBe(false);
  });

  it("formats ParseError messages", () => {
    const error = new ParseError({
      line: 12,
      column: 8,
      message: "Unexpected token",
      source: "<!--@ bad ... -->",
    });

    expect(formatMetadataParseError(error)).toBe(
      "Parse error at line 12, column 8: Unexpected token",
    );
  });
});
