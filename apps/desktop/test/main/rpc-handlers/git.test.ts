import * as fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createHandlersWithOverrides } from "./helpers";

const runGit = (cwd: string, args: ReadonlyArray<string>): string =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
  }).trim();

const runBareGit = (gitDir: string, args: ReadonlyArray<string>): string =>
  execFileSync("git", [`--git-dir=${gitDir}`, ...args], {
    encoding: "utf8",
  }).trim();

const configureLocalGitIdentity = (cwd: string): void => {
  runGit(cwd, ["config", "user.name", "re Desktop Test"]);
  runGit(cwd, ["config", "user.email", "desktop-test@example.com"]);
};

const seedRemoteRepository = async (): Promise<{
  readonly remotePath: string;
  readonly workspacePath: string;
}> => {
  const remotePath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-remote-"));
  const seedPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-seed-"));
  const workspacePath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-workspace-"));

  await fs.rm(workspacePath, { recursive: true, force: true });

  runGit(remotePath, ["init", "--bare"]);
  runGit(seedPath, ["init"]);
  configureLocalGitIdentity(seedPath);
  await fs.writeFile(path.join(seedPath, "cards.md"), "# initial\n", "utf8");
  runGit(seedPath, ["add", "cards.md"]);
  runGit(seedPath, ["commit", "-m", "initial"]);
  runGit(seedPath, ["remote", "add", "origin", remotePath]);
  runGit(seedPath, ["push", "-u", "origin", "master"]);
  execFileSync("git", ["clone", remotePath, workspacePath], { encoding: "utf8" });
  configureLocalGitIdentity(workspacePath);

  await fs.rm(seedPath, { recursive: true, force: true });

  return { remotePath, workspacePath };
};

describe("git handlers", () => {
  it("reports unavailable when the workspace root is not a git repository", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-unavailable-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");

    try {
      const handlers = await createHandlersWithOverrides(settingsFilePath);
      const snapshot = await Effect.runPromise(handlers.GetGitSyncSnapshot({ rootPath }));

      expect(snapshot).toEqual({
        _tag: "GitSyncUnavailable",
        reason: "not_a_repository",
        message: "The configured workspace root is not a Git repository.",
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("detects an in-progress git operation from git sentinel paths", async () => {
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const { workspacePath, remotePath } = await seedRemoteRepository();

    try {
      const mergeHeadPath = path.resolve(
        workspacePath,
        runGit(workspacePath, ["rev-parse", "--git-path", "MERGE_HEAD"]),
      );
      await fs.writeFile(mergeHeadPath, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n", "utf8");

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      const snapshot = await Effect.runPromise(
        handlers.GetGitSyncSnapshot({ rootPath: workspacePath }),
      );

      expect(snapshot._tag).toBe("GitSyncBlocked");
      if (snapshot._tag === "GitSyncBlocked") {
        expect(snapshot.reason).toBe("git_operation_in_progress");
      }
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
      await fs.rm(remotePath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("commits local changes and pushes them to the tracked remote branch", async () => {
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const { workspacePath, remotePath } = await seedRemoteRepository();
    const deckPath = path.join(workspacePath, "cards.md");

    try {
      await fs.appendFile(deckPath, "new card\n", "utf8");

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      const result = await Effect.runPromise(handlers.RunGitSync({ rootPath: workspacePath }));

      expect(result.createdCommit).toBe(true);
      expect(result.pushed).toBe(true);
      expect(result.snapshot._tag).toBe("GitSyncReady");

      const workspaceHead = runGit(workspacePath, ["rev-parse", "HEAD"]);
      const remoteHead = runBareGit(remotePath, ["rev-parse", "refs/heads/master"]);
      expect(remoteHead).toBe(workspaceHead);
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
      await fs.rm(remotePath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });
});
