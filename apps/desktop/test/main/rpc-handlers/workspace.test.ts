import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import {
  DeckAlreadyExists,
  DeckFileOperationError,
  DeckFileNotFound,
  InvalidDeckPath,
  WorkspaceRootNotFound as SnapshotWorkspaceRootNotFound,
} from "@re/workspace";
import { WorkspaceRootPathNotConfiguredError } from "@shared/rpc/schemas/workspace";
import { WorkspaceRootNotFound as SettingsWorkspaceRootNotFound } from "@shared/settings";

import { createHandlersWithOverrides, defaultHandlers } from "./helpers";

describe("workspace handlers", () => {
  it("returns bootstrap payload", async () => {
    const result = await Effect.runPromise(defaultHandlers.GetBootstrapData({}));

    expect(result.appName).toBe("re Desktop");
    expect(result.message).toContain("typed Effect RPC");
  });

  it("parses markdown and returns item/card counts", async () => {
    const markdown = `---
title: Sample
---

<!--@ card-a 0 0 0 0-->
Question one
---
Answer one

<!--@ card-b 0 0 0 0-->
Question two
---
Answer two
`;

    const result = await Effect.runPromise(defaultHandlers.ParseDeckPreview({ markdown }));

    expect(result).toEqual({
      items: 2,
      cards: 2,
    });
  });

  it("returns parser tagged errors through the domain error channel", async () => {
    const invalidMarkdown = `<!--@ bad-card 0 0 9 0-->
Broken card content`;

    const exit = await Effect.runPromiseExit(
      defaultHandlers.ParseDeckPreview({ markdown: invalidMarkdown }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected ParseDeckPreview to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "None") {
      throw new Error("Expected a domain failure, but received a defect or interruption.");
    }

    expect(failure.value._tag).toBe("InvalidFieldValue");
    if (failure.value._tag === "InvalidFieldValue") {
      expect(failure.value.line).toBe(1);
      expect(failure.value.field).toBe("metadata");
      expect(failure.value.value).toContain("bad-card");
    }
  });

  it("scans decks and returns full deck entries", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-scan-"));

    try {
      await fs.mkdir(path.join(rootPath, "nested"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "root.md"), "# root", "utf8");
      await fs.writeFile(path.join(rootPath, "nested/child.md"), "# child", "utf8");
      await fs.writeFile(path.join(rootPath, "nested/ignore.txt"), "not a deck", "utf8");

      const result = await Effect.runPromise(defaultHandlers.ScanDecks({ rootPath }));

      expect(result.rootPath).toBe(rootPath);
      expect(result.decks).toEqual([
        {
          absolutePath: path.join(rootPath, "nested/child.md"),
          relativePath: "nested/child.md",
          name: "child",
        },
        {
          absolutePath: path.join(rootPath, "root.md"),
          relativePath: "root.md",
          name: "root",
        },
      ]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns workspace snapshot with mixed deck statuses", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-snapshot-"));
    const okDeckPath = path.join(rootPath, "1-ok.md");
    const readErrorDeckPath = path.join(rootPath, "2-read-error.md");
    const parseErrorDeckPath = path.join(rootPath, "3-parse-error.md");

    try {
      await fs.writeFile(
        okDeckPath,
        `<!--@ card-a 0 0 0 0-->
Question
---
Answer
`,
        "utf8",
      );
      await fs.writeFile(readErrorDeckPath, "# unreadable", "utf8");
      await fs.writeFile(parseErrorDeckPath, "<!--@ bad 0 0 9 0-->", "utf8");
      await fs.chmod(readErrorDeckPath, 0o000);

      const result = await Effect.runPromise(
        defaultHandlers.GetWorkspaceSnapshot({
          rootPath,
          options: {
            includeHidden: false,
            extraIgnorePatterns: [],
          },
        }),
      );

      expect(result.rootPath).toBe(rootPath);
      expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);
      expect(result.decks).toHaveLength(3);
      expect(result.decks.map((deck) => deck.status)).toEqual(["ok", "read_error", "parse_error"]);

      const okDeck = result.decks.find((deck) => deck.name === "1-ok");
      expect(okDeck).toBeDefined();
      if (okDeck?.status === "ok") {
        expect(okDeck.totalCards).toBe(1);
        expect(okDeck.dueCards).toBe(0);
        expect(okDeck.stateCounts).toEqual({
          new: 1,
          learning: 0,
          review: 0,
          relearning: 0,
        });
      } else {
        throw new Error("Expected 1-ok deck to succeed.");
      }
    } finally {
      await fs.chmod(readErrorDeckPath, 0o644).catch(() => undefined);
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns typed root errors for workspace snapshot", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-snapshot-error-"));
    const nonexistentRoot = path.join(rootPath, "missing");

    try {
      const exit = await Effect.runPromiseExit(
        defaultHandlers.GetWorkspaceSnapshot({
          rootPath: nonexistentRoot,
          options: {
            includeHidden: false,
            extraIgnorePatterns: [],
          },
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetWorkspaceSnapshot to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SnapshotWorkspaceRootNotFound);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns default settings when settings file is missing", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-settings-"));
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      const result = await Effect.runPromise(handlers.GetSettings({}));

      expect(result).toEqual({
        settingsVersion: 1,
        workspace: { rootPath: null },
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("sets workspace root path and returns updated settings", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-settings-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      const result = await Effect.runPromise(
        handlers.SetWorkspaceRootPath({ rootPath: workspacePath }),
      );

      expect(result.workspace.rootPath).toBe(workspacePath);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns typed domain error for invalid workspace root path", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-settings-"));
    const settingsFilePath = path.join(rootPath, "settings.json");
    const nonexistentPath = path.join(rootPath, "missing");

    try {
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      const exit = await Effect.runPromiseExit(
        handlers.SetWorkspaceRootPath({ rootPath: nonexistentPath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected SetWorkspaceRootPath to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SettingsWorkspaceRootNotFound);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("starts watcher on SetWorkspaceRootPath success and stops on null", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-watcher-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });

      const spyWatcher: WorkspaceWatcher = {
        start: vi.fn(),
        stop: vi.fn(),
      };
      const handlers = await createHandlersWithOverrides(settingsFilePath, {
        watcher: spyWatcher,
      });

      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      expect(spyWatcher.start).toHaveBeenCalledWith(workspacePath);
      expect(spyWatcher.stop).not.toHaveBeenCalled();

      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: null }));

      expect(spyWatcher.stop).toHaveBeenCalled();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("CreateDeck returns typed error when workspace root is not configured", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-create-deck-"));
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      const exit = await Effect.runPromiseExit(
        handlers.CreateDeck({
          relativePath: "books/book1.md",
          createParents: true,
          initialContent: "# book1\n",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected CreateDeck to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(WorkspaceRootPathNotConfiguredError);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("creates and deletes a deck file through workspace handlers", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-create-delete-deck-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const created = await Effect.runPromise(
        handlers.CreateDeck({
          relativePath: "books/book1.md",
          createParents: true,
          initialContent: "# book1\n",
        }),
      );

      const expectedDeckPath = path.join(workspacePath, "books/book1.md");
      expect(created.absolutePath).toBe(expectedDeckPath);
      await expect(fs.readFile(expectedDeckPath, "utf8")).resolves.toBe("# book1\n");

      await Effect.runPromise(handlers.DeleteDeck({ relativePath: "books/book1.md" }));

      await expect(fs.readFile(expectedDeckPath, "utf8")).rejects.toBeDefined();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("renames a deck file through workspace handlers", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-rename-deck-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");
    const fromRelativePath = "books/book1.md";
    const toRelativePath = "books/book-01.md";

    try {
      await fs.mkdir(path.join(workspacePath, "books"), { recursive: true });
      await fs.writeFile(path.join(workspacePath, fromRelativePath), "# old\n", "utf8");

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const result = await Effect.runPromise(
        handlers.RenameDeck({
          fromRelativePath,
          toRelativePath,
        }),
      );

      expect(result.absolutePath).toBe(path.join(workspacePath, toRelativePath));
      await expect(fs.readFile(path.join(workspacePath, fromRelativePath), "utf8")).rejects.toBeDefined();
      await expect(fs.readFile(path.join(workspacePath, toRelativePath), "utf8")).resolves.toBe("# old\n");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns DeckAlreadyExists for CreateDeck when destination already exists", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-create-exists-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(path.join(workspacePath, "books"), { recursive: true });
      await fs.writeFile(path.join(workspacePath, "books/book1.md"), "# old\n", "utf8");

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const exit = await Effect.runPromiseExit(
        handlers.CreateDeck({
          relativePath: "books/book1.md",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected CreateDeck to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(DeckAlreadyExists);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns DeckFileNotFound for DeleteDeck when destination does not exist", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-delete-missing-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const exit = await Effect.runPromiseExit(
        handlers.DeleteDeck({
          relativePath: "books/missing.md",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected DeleteDeck to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(DeckFileNotFound);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns InvalidDeckPath for absolute CreateDeck relativePath", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-invalid-relative-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const exit = await Effect.runPromiseExit(
        handlers.CreateDeck({
          relativePath: path.join("/", "tmp", "absolute.md"),
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected CreateDeck to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(InvalidDeckPath);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns InvalidDeckPath for CreateDeck path traversal attempts", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-invalid-traversal-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const exit = await Effect.runPromiseExit(
        handlers.CreateDeck({
          relativePath: "../../etc/passwd.md",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected CreateDeck to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(InvalidDeckPath);
        if (failure.value instanceof InvalidDeckPath) {
          expect(failure.value.reason).toBe("path_traversal_not_allowed");
        }
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns InvalidDeckPath for CreateDeck paths containing NUL bytes", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-invalid-nul-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const exit = await Effect.runPromiseExit(
        handlers.CreateDeck({
          relativePath: "books/\0book1.md",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected CreateDeck to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(InvalidDeckPath);
        if (failure.value instanceof InvalidDeckPath) {
          expect(failure.value.reason).toBe("nul_byte_not_allowed");
        }
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns DeckFileOperationError when CreateDeck parent does not exist and createParents is false", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-create-missing-parent-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const exit = await Effect.runPromiseExit(
        handlers.CreateDeck({
          relativePath: "books/book1.md",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected CreateDeck to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(DeckFileOperationError);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
