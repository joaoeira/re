import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { NodeServicesLive } from "@main/effect/node-services";
import { makeSettingsRepository } from "@main/settings/repository";
import {
  SettingsDecodeFailed,
  SettingsWriteFailed,
  WorkspaceRootNotDirectory,
  WorkspaceRootNotFound,
} from "@shared/settings";

const makeRepository = (settingsFilePath: string) =>
  makeSettingsRepository({ settingsFilePath }).pipe(
    Effect.provide(NodeServicesLive),
    Effect.runPromise,
  );

describe("settings repository", () => {
  it("returns defaults when settings file is missing and does not materialize file", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      const repository = await makeRepository(settingsFilePath);
      const settings = await Effect.runPromise(repository.getSettings());

      expect(settings).toEqual({
        settingsVersion: 1,
        workspace: { rootPath: null },
      });

      await expect(fs.access(settingsFilePath)).rejects.toThrow();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("materializes settings file on first successful write", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });

      const repository = await makeRepository(settingsFilePath);
      await Effect.runPromise(repository.setWorkspaceRootPath({ rootPath: workspacePath }));

      const rawSettings = await fs.readFile(settingsFilePath, "utf8");
      const parsedSettings = JSON.parse(rawSettings) as {
        workspace: { rootPath: string };
      };

      expect(parsedSettings.workspace.rootPath).toBe(workspacePath);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("normalizes and persists a valid directory workspace root", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const repository = await makeRepository(settingsFilePath);

      const result = await Effect.runPromise(
        repository.setWorkspaceRootPath({
          rootPath: path.join(workspacePath, "..", "workspace"),
        }),
      );

      expect(result.workspace.rootPath).toBe(workspacePath);
      const persisted = await Effect.runPromise(repository.getSettings());
      expect(persisted.workspace.rootPath).toBe(workspacePath);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("clears workspace root path when null is provided", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const repository = await makeRepository(settingsFilePath);

      await Effect.runPromise(repository.setWorkspaceRootPath({ rootPath: workspacePath }));
      const cleared = await Effect.runPromise(repository.setWorkspaceRootPath({ rootPath: null }));

      expect(cleared.workspace.rootPath).toBeNull();
      const persisted = await Effect.runPromise(repository.getSettings());
      expect(persisted.workspace.rootPath).toBeNull();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails with WorkspaceRootNotFound for nonexistent directory", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const settingsFilePath = path.join(rootPath, "settings.json");
    const missingPath = path.join(rootPath, "missing");

    try {
      const repository = await makeRepository(settingsFilePath);
      const exit = await Effect.runPromiseExit(
        repository.setWorkspaceRootPath({ rootPath: missingPath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected setWorkspaceRootPath to fail.");
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

  it("fails with WorkspaceRootNotDirectory when path points to file", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const filePath = path.join(rootPath, "deck.md");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.writeFile(filePath, "# deck", "utf8");
      const repository = await makeRepository(settingsFilePath);
      const exit = await Effect.runPromiseExit(
        repository.setWorkspaceRootPath({ rootPath: filePath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected setWorkspaceRootPath to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(WorkspaceRootNotDirectory);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails with SettingsDecodeFailed when settings file is corrupt", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.writeFile(settingsFilePath, "{ not valid json", "utf8");
      const repository = await makeRepository(settingsFilePath);
      const exit = await Effect.runPromiseExit(repository.getSettings());

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected getSettings to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SettingsDecodeFailed);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("fails set operation with SettingsDecodeFailed when existing file is corrupt", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-settings-repo-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      await fs.writeFile(settingsFilePath, "{ broken json", "utf8");
      const repository = await makeRepository(settingsFilePath);
      const exit = await Effect.runPromiseExit(
        repository.setWorkspaceRootPath({ rootPath: workspacePath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected setWorkspaceRootPath to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SettingsDecodeFailed);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns SettingsWriteFailed when persistence cannot write to disk", async () => {
    const settingsFilePath = "/virtual/userData/settings.json";

    const makeSystemError = (
      reason: "NotFound" | "PermissionDenied",
      method: string,
      pathOrDescriptor: string,
    ): SystemError =>
      new SystemError({
        reason,
        module: "FileSystem",
        method,
        pathOrDescriptor,
      });

    const failingFileSystem = FileSystem.layerNoop({
      readFileString: () =>
        Effect.fail(makeSystemError("NotFound", "readFileString", settingsFilePath)),
      makeDirectory: () => Effect.void,
      open: () => Effect.fail(makeSystemError("PermissionDenied", "open", settingsFilePath)),
      remove: () => Effect.void,
    });

    const repository = await makeSettingsRepository({ settingsFilePath }).pipe(
      Effect.provide(Layer.merge(failingFileSystem, Path.layer)),
      Effect.runPromise,
    );

    const exit = await Effect.runPromiseExit(repository.setWorkspaceRootPath({ rootPath: null }));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected setWorkspaceRootPath to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(SettingsWriteFailed);
    }
  });
});
