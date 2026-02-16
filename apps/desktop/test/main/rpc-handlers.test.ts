import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { NodeServicesLive } from "@main/effect/node-services";
import { createAppRpcHandlers } from "@main/rpc/handlers";
import { makeSettingsRepository } from "@main/settings/repository";
import type { SettingsRepository } from "@main/settings/repository";
import { DEFAULT_SETTINGS, WorkspaceRootNotFound } from "@shared/settings";

const stubSettingsRepository: SettingsRepository = {
  getSettings: () => Effect.succeed(DEFAULT_SETTINGS),
  setWorkspaceRootPath: ({ rootPath }) =>
    Effect.succeed({
      ...DEFAULT_SETTINGS,
      workspace: {
        rootPath,
      },
    }),
};

const handlers = createAppRpcHandlers(stubSettingsRepository);

const createHandlers = async (settingsFilePath: string) =>
  Effect.gen(function* () {
    const repository = yield* makeSettingsRepository({ settingsFilePath });
    return createAppRpcHandlers(repository);
  }).pipe(Effect.provide(NodeServicesLive), Effect.runPromise);

describe("main rpc handlers", () => {
  it("returns bootstrap payload", async () => {
    const result = await Effect.runPromise(handlers.GetBootstrapData({}));

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

    const result = await Effect.runPromise(handlers.ParseDeckPreview({ markdown }));

    expect(result).toEqual({
      items: 2,
      cards: 2,
    });
  });

  it("returns parser tagged errors through the domain error channel", async () => {
    const invalidMarkdown = `<!--@ bad-card 0 0 9 0-->
Broken card content`;

    const exit = await Effect.runPromiseExit(
      handlers.ParseDeckPreview({ markdown: invalidMarkdown }),
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

      const result = await Effect.runPromise(handlers.ScanDecks({ rootPath }));

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

  it("returns default settings when settings file is missing", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-settings-"));
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      const handlers = await createHandlers(settingsFilePath);
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

      const handlers = await createHandlers(settingsFilePath);
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
      const handlers = await createHandlers(settingsFilePath);
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
        expect(failure.value).toBeInstanceOf(WorkspaceRootNotFound);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
