import * as fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import * as CommandExecutor from "@effect/platform/CommandExecutor";
import { NodeServicesLive } from "@main/effect/node-services";
import { makeGitCommandRunner } from "@main/git/command-runner";
import { makeGitSyncService } from "@main/git/sync-service";
import { createGitSyncCoordinator } from "@main/git/sync-coordinator";
import { makeSettingsRepository } from "@main/settings/repository";
import { makeDuplicateIndexInvalidationBridgeService } from "@main/di/services/DuplicateIndexInvalidationService";
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

  it(
    "requests retry when an editor save changes the workspace during fetch",
    { timeout: 15_000 },
    async () => {
      const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-settings-"));
      const { workspacePath, remotePath } = await seedRemoteRepository();
      const deckPath = path.join(workspacePath, "cards.md");
      try {
        const settingsRepository = await Effect.runPromise(
          makeSettingsRepository({
            settingsFilePath: path.join(settingsRoot, "settings.json"),
          }).pipe(Effect.provide(NodeServicesLive)),
        );
        const gitSyncCoordinator = createGitSyncCoordinator();
        const handlers = await createHandlersWithOverrides(
          path.join(settingsRoot, "settings.json"),
          {
            settingsRepository,
            gitSyncCoordinator,
          },
        );
        await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));
        const originalRemoteHead = runBareGit(remotePath, ["rev-parse", "refs/heads/master"]);
        await fs.appendFile(deckPath, "Before fetch\n");
        let editDuringFetch = true;
        const syncService = await Effect.runPromise(
          Effect.gen(function* () {
            const fileSystem = yield* FileSystem.FileSystem;
            const commandExecutor = yield* CommandExecutor.CommandExecutor;
            const runner = makeGitCommandRunner({ commandExecutor });
            return makeGitSyncService({
              fileSystem,
              settingsRepository,
              gitSyncCoordinator,
              duplicateIndexInvalidation: makeDuplicateIndexInvalidationBridgeService(),
              gitCommandRunner: {
                run: (input) =>
                  Effect.gen(function* () {
                    if (input.args[0] === "fetch" && editDuringFetch) {
                      editDuringFetch = false;
                      yield* handlers
                        .AppendItem({
                          deckPath,
                          cardType: "qa",
                          content: "Saved during fetch\n---\nAnswer",
                        })
                        .pipe(Effect.orDie);
                    }
                    return yield* runner.run(input);
                  }),
              },
            });
          }).pipe(Effect.provide(NodeServicesLive)),
        );

        const result = await Effect.runPromise(
          syncService.sync({ rootPath: workspacePath }).pipe(Effect.either),
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: {
            _tag: "GitSyncNotReadyError",
            message: "Workspace changed while sync was fetching remote updates. Retry sync.",
          },
        });
        expect(await fs.readFile(deckPath, "utf8")).toContain("Saved during fetch");
        expect(runBareGit(remotePath, ["rev-parse", "refs/heads/master"])).toBe(originalRemoteHead);
        const retry = await Effect.runPromise(syncService.sync({ rootPath: workspacePath }));
        expect(retry.pushed).toBe(true);
        expect(runBareGit(remotePath, ["show", "refs/heads/master:cards.md"])).toContain(
          "Saved during fetch",
        );
      } finally {
        await fs.rm(workspacePath, { recursive: true, force: true });
        await fs.rm(remotePath, { recursive: true, force: true });
        await fs.rm(settingsRoot, { recursive: true, force: true });
      }
    },
  );

  it("commits user files without staging unfinished deck writes", { timeout: 15_000 }, async () => {
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-settings-"));
    const { workspacePath, remotePath } = await seedRemoteRepository();
    try {
      await fs.appendFile(path.join(workspacePath, "cards.md"), "new card\n");
      await fs.mkdir(path.join(workspacePath, "nested"));
      await fs.writeFile(path.join(workspacePath, ".re-write-root.tmp"), "incomplete deck");
      await fs.writeFile(
        path.join(workspacePath, "nested/.re-write-nested.tmp"),
        "incomplete deck",
      );
      await fs.writeFile(path.join(workspacePath, "notes.tmp"), "User file");
      const handlers = await createHandlersWithOverrides(path.join(settingsRoot, "settings.json"));
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));
      const result = await Effect.runPromise(
        handlers.RunGitSync({ rootPath: workspacePath }).pipe(Effect.either),
      );
      expect(runGit(workspacePath, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n")).toEqual([
        "cards.md",
        "notes.tmp",
      ]);
      // The unfinished save still makes the workspace dirty; sync must request a retry.
      expect(result).toMatchObject({ _tag: "Left", left: { _tag: "GitSyncNotReadyError" } });
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
      await fs.rm(remotePath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it(
    "completes two concurrent syncs with one commit pushed to the remote",
    { timeout: 15_000 },
    async () => {
      const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-git-settings-"));
      const settingsFilePath = path.join(settingsRoot, "settings.json");
      const { workspacePath, remotePath } = await seedRemoteRepository();
      const deckPath = path.join(workspacePath, "cards.md");

      try {
        await fs.appendFile(deckPath, "new card\n", "utf8");

        const handlers = await createHandlersWithOverrides(settingsFilePath);
        await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

        const initialHead = runGit(workspacePath, ["rev-parse", "HEAD"]);
        const results = await Effect.runPromise(
          Effect.all(
            [
              handlers.RunGitSync({ rootPath: workspacePath }),
              handlers.RunGitSync({ rootPath: workspacePath }),
            ],
            { concurrency: "unbounded" },
          ),
        );

        expect(results.filter((result) => result.createdCommit)).toHaveLength(1);
        expect(results.every((result) => result.snapshot._tag === "GitSyncReady")).toBe(true);
        expect(runGit(workspacePath, ["rev-list", "--count", `${initialHead}..HEAD`])).toBe("1");

        const workspaceHead = runGit(workspacePath, ["rev-parse", "HEAD"]);
        const remoteHead = runBareGit(remotePath, ["rev-parse", "refs/heads/master"]);
        expect(remoteHead).toBe(workspaceHead);
      } finally {
        await fs.rm(workspacePath, { recursive: true, force: true });
        await fs.rm(remotePath, { recursive: true, force: true });
        await fs.rm(settingsRoot, { recursive: true, force: true });
      }
    },
  );
});
