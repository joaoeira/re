import path from "node:path";

import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import type { DuplicateIndexInvalidationService } from "@main/di/services/DuplicateIndexInvalidationService";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceMutationCoordinator } from "@main/workspace/workspace-mutation-coordinator";
import { toErrorMessage } from "@main/utils/format";
import {
  GitBinaryNotAvailableError,
  GitCommandFailedError,
  GitCommandTransportError,
  GitSyncConflictError,
  GitSyncNotReadyError,
  toGitSyncSnapshotMessage,
  type GitSyncBlocked,
  type GitSyncReady,
  type GitSyncResult,
  type GitSyncSnapshot,
  type GitSyncUnavailable,
} from "@shared/git";
import type { GitCommandResult, GitCommandRunner } from "./command-runner";

export interface GitSyncService {
  readonly getSnapshot: (input: { readonly rootPath: string }) => Effect.Effect<GitSyncSnapshot>;
  readonly sync: (input: {
    readonly rootPath: string;
  }) => Effect.Effect<
    GitSyncResult,
    | GitBinaryNotAvailableError
    | GitCommandTransportError
    | GitCommandFailedError
    | GitSyncConflictError
    | GitSyncNotReadyError
  >;
}

type GitSyncServiceDependencies = {
  readonly fileSystem: FileSystem.FileSystem;
  readonly gitCommandRunner: GitCommandRunner;
  readonly settingsRepository: SettingsRepository;
  readonly mutationCoordinator: WorkspaceMutationCoordinator;
  readonly duplicateIndexInvalidation: DuplicateIndexInvalidationService;
};

type ParsedGitStatus = {
  readonly ahead: number;
  readonly behind: number;
  readonly hasStagedChanges: boolean;
  readonly hasUnstagedChanges: boolean;
  readonly hasUntrackedChanges: boolean;
  readonly hasUnmergedChanges: boolean;
  readonly hasLocalChanges: boolean;
};

type CommitPhaseResult = {
  readonly createdCommit: boolean;
  readonly commitHash: string | null;
};

type IntegrationPhaseResult = {
  readonly rebased: boolean;
  readonly snapshot: GitSyncReady;
};

const trimTrailingNewlines = (value: string): string => value.replace(/\r?\n$/, "");

const makeUnavailable = (
  reason: GitSyncUnavailable["reason"],
  message: string,
): GitSyncUnavailable => ({
  _tag: "GitSyncUnavailable",
  reason,
  message,
});

const makeBlocked = (input: {
  readonly reason: GitSyncBlocked["reason"];
  readonly message: string;
  readonly branch: string | null;
  readonly upstream: string | null;
}): GitSyncBlocked => ({
  _tag: "GitSyncBlocked",
  ...input,
});

const makeReady = (input: Omit<GitSyncReady, "_tag">): GitSyncReady => ({
  _tag: "GitSyncReady",
  ...input,
});

const normalizeMergeRef = (mergeRef: string): string | null => {
  const trimmed = trimTrailingNewlines(mergeRef).trim();
  return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : null;
};

const parseGitStatusPorcelainV2 = (raw: string): ParsedGitStatus => {
  let ahead = 0;
  let behind = 0;
  let hasStagedChanges = false;
  let hasUnstagedChanges = false;
  let hasUntrackedChanges = false;
  let hasUnmergedChanges = false;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("# branch.ab ")) {
      const match = /# branch\.ab \+(\d+) -(\d+)/.exec(line);
      if (match) {
        ahead = Number.parseInt(match[1] ?? "0", 10);
        behind = Number.parseInt(match[2] ?? "0", 10);
      }
      continue;
    }

    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const statusToken = line.split(" ", 3)[1];
      if (!statusToken || statusToken.length < 2) continue;
      if (statusToken[0] !== ".") hasStagedChanges = true;
      if (statusToken[1] !== ".") hasUnstagedChanges = true;
      continue;
    }

    if (line.startsWith("u ")) {
      hasUnmergedChanges = true;
      continue;
    }

    if (line.startsWith("? ")) {
      hasUntrackedChanges = true;
    }
  }

  return {
    ahead,
    behind,
    hasStagedChanges,
    hasUnstagedChanges,
    hasUntrackedChanges,
    hasUnmergedChanges,
    hasLocalChanges:
      hasStagedChanges || hasUnstagedChanges || hasUntrackedChanges || hasUnmergedChanges,
  };
};

const hasNotARepositoryMessage = (result: GitCommandResult): boolean =>
  /not a git repository/i.test(result.stderr);

const commandFailedError = (
  args: ReadonlyArray<string>,
  result: GitCommandResult,
): GitCommandFailedError =>
  new GitCommandFailedError({
    command: ["git", ...args],
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  });

const normalizeRootPath = (rootPath: string): string => path.resolve(rootPath);

export const makeGitSyncService = ({
  fileSystem,
  gitCommandRunner,
  settingsRepository,
  mutationCoordinator,
  duplicateIndexInvalidation,
}: GitSyncServiceDependencies): GitSyncService => {
  const canonicalizeRootPath = (rootPath: string): Effect.Effect<string> =>
    fileSystem.realPath(rootPath).pipe(Effect.orElseSucceed(() => normalizeRootPath(rootPath)));

  const repositoryStateUnreadable = (message: string): GitSyncUnavailable =>
    makeUnavailable("repository_state_unreadable", message);

  const runGit = (rootPath: string, args: ReadonlyArray<string>) =>
    gitCommandRunner.run({
      cwd: rootPath,
      args,
    });

  const runGitForSnapshot = (
    rootPath: string,
    args: ReadonlyArray<string>,
  ): Effect.Effect<GitCommandResult, GitSyncUnavailable> =>
    runGit(rootPath, args).pipe(
      Effect.catchTag("GitBinaryNotAvailableError", (error) =>
        Effect.fail(makeUnavailable("git_not_installed", error.message)),
      ),
      Effect.catchTag("GitCommandTransportError", (error) =>
        Effect.fail(repositoryStateUnreadable(error.message)),
      ),
    );

  const expectExitCodes = (
    args: ReadonlyArray<string>,
    result: GitCommandResult,
    expected: ReadonlyArray<number>,
  ): Effect.Effect<GitCommandResult, GitCommandFailedError> =>
    expected.includes(result.exitCode)
      ? Effect.succeed(result)
      : Effect.fail(commandFailedError(args, result));

  const readOptionalConfigValue = (
    rootPath: string,
    key: string,
    missingReason: GitSyncBlocked["reason"],
    missingMessage: string,
    branch: string,
    upstream: string | null,
  ): Effect.Effect<string, GitSyncUnavailable | GitSyncBlocked> =>
    runGitForSnapshot(rootPath, ["config", "--get", key]).pipe(
      Effect.flatMap((result): Effect.Effect<string, GitSyncUnavailable | GitSyncBlocked> => {
        if (result.exitCode === 0) {
          return Effect.succeed(trimTrailingNewlines(result.stdout).trim());
        }

        if (result.exitCode === 1) {
          return Effect.fail(
            makeBlocked({
              reason: missingReason,
              message: missingMessage,
              branch,
              upstream,
            }),
          );
        }

        return Effect.fail(
          repositoryStateUnreadable(
            result.stderr.trim() || `Unable to read git config key: ${key}`,
          ),
        );
      }),
    );

  const readCurrentBranch = (
    rootPath: string,
  ): Effect.Effect<string, GitSyncUnavailable | GitSyncBlocked> =>
    runGitForSnapshot(rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]).pipe(
      Effect.flatMap((result): Effect.Effect<string, GitSyncUnavailable | GitSyncBlocked> => {
        if (result.exitCode === 0) {
          return Effect.succeed(trimTrailingNewlines(result.stdout).trim());
        }

        if (result.exitCode === 1) {
          return Effect.fail(
            makeBlocked({
              reason: "detached_head",
              message: "Sync is unavailable while HEAD is detached.",
              branch: null,
              upstream: null,
            }),
          );
        }

        return Effect.fail(
          repositoryStateUnreadable(
            result.stderr.trim() || "Unable to determine the current git branch.",
          ),
        );
      }),
    );

  const readCommitIdentityConfigured = (
    rootPath: string,
  ): Effect.Effect<boolean, GitSyncUnavailable> =>
    Effect.gen(function* () {
      const [userNameResult, userEmailResult] = yield* Effect.all([
        runGitForSnapshot(rootPath, ["config", "--get", "user.name"]),
        runGitForSnapshot(rootPath, ["config", "--get", "user.email"]),
      ]);

      const readValue = (
        result: GitCommandResult,
        label: "user.name" | "user.email",
      ): Effect.Effect<boolean, GitSyncUnavailable> => {
        if (result.exitCode === 0) {
          return Effect.succeed(result.stdout.trim().length > 0);
        }

        if (result.exitCode === 1) {
          return Effect.succeed(false);
        }

        return Effect.fail(
          repositoryStateUnreadable(
            result.stderr.trim() || `Unable to inspect git config key: ${label}`,
          ),
        );
      };

      const userNameConfigured = yield* readValue(userNameResult, "user.name");
      const userEmailConfigured = yield* readValue(userEmailResult, "user.email");

      return userNameConfigured && userEmailConfigured;
    });

  const readGitStatePath = (
    rootPath: string,
    marker: string,
  ): Effect.Effect<string, GitSyncUnavailable> =>
    runGitForSnapshot(rootPath, ["rev-parse", "--git-path", marker]).pipe(
      Effect.flatMap((result) => {
        if (result.exitCode === 0) {
          return Effect.succeed(path.resolve(rootPath, trimTrailingNewlines(result.stdout).trim()));
        }

        return Effect.fail(
          repositoryStateUnreadable(
            result.stderr.trim() || `Unable to inspect git state marker: ${marker}`,
          ),
        );
      }),
    );

  const detectOperationInProgress = (
    rootPath: string,
    branch: string | null,
    upstream: string | null,
  ): Effect.Effect<void, GitSyncUnavailable | GitSyncBlocked> =>
    Effect.gen(function* () {
      const markers = [
        {
          marker: "rebase-merge",
          message: "Git rebase is already in progress. Resolve it outside the app and retry sync.",
        },
        {
          marker: "rebase-apply",
          message: "Git rebase is already in progress. Resolve it outside the app and retry sync.",
        },
        {
          marker: "MERGE_HEAD",
          message: "Git merge is already in progress. Resolve it outside the app and retry sync.",
        },
        {
          marker: "CHERRY_PICK_HEAD",
          message:
            "Git cherry-pick is already in progress. Resolve it outside the app and retry sync.",
        },
        {
          marker: "REVERT_HEAD",
          message: "Git revert is already in progress. Resolve it outside the app and retry sync.",
        },
      ] as const;

      for (const entry of markers) {
        const markerPath = yield* readGitStatePath(rootPath, entry.marker);
        const exists = yield* fileSystem
          .exists(markerPath)
          .pipe(Effect.mapError((error) => repositoryStateUnreadable(toErrorMessage(error))));

        if (exists) {
          return yield* Effect.fail(
            makeBlocked({
              reason: "git_operation_in_progress",
              message: entry.message,
              branch,
              upstream,
            }),
          );
        }
      }
    });

  const resolveRepoRoot = (resolvedRootPath: string): Effect.Effect<string, GitSyncUnavailable> =>
    runGitForSnapshot(resolvedRootPath, ["rev-parse", "--show-toplevel"]).pipe(
      Effect.flatMap((result) => {
        if (result.exitCode === 0) {
          return canonicalizeRootPath(trimTrailingNewlines(result.stdout).trim()).pipe(
            Effect.flatMap((repoRootPath) =>
              repoRootPath === resolvedRootPath
                ? Effect.succeed(repoRootPath)
                : Effect.fail(
                    makeUnavailable(
                      "workspace_root_is_not_repo_root",
                      "Sync requires the workspace root to be the Git repository root.",
                    ),
                  ),
            ),
          );
        }

        if (hasNotARepositoryMessage(result)) {
          return Effect.fail(
            makeUnavailable(
              "not_a_repository",
              "The configured workspace root is not a Git repository.",
            ),
          );
        }

        return Effect.fail(
          repositoryStateUnreadable(
            result.stderr.trim() || "Unable to inspect the Git repository.",
          ),
        );
      }),
    );

  const getSnapshotEffect = (input: {
    readonly rootPath: string;
  }): Effect.Effect<GitSyncReady, GitSyncUnavailable | GitSyncBlocked> =>
    Effect.gen(function* () {
      const resolvedRootPath = yield* canonicalizeRootPath(input.rootPath);
      const repoRootPath = yield* resolveRepoRoot(resolvedRootPath);
      const branch = yield* readCurrentBranch(resolvedRootPath);

      const remoteName = yield* readOptionalConfigValue(
        resolvedRootPath,
        `branch.${branch}.remote`,
        "no_upstream",
        "The current branch has no configured upstream remote.",
        branch,
        null,
      );

      const mergeRef = yield* readOptionalConfigValue(
        resolvedRootPath,
        `branch.${branch}.merge`,
        "no_upstream",
        "The current branch has no configured upstream branch.",
        branch,
        null,
      );

      const remoteBranchName = normalizeMergeRef(mergeRef);
      if (!remoteBranchName) {
        return yield* Effect.fail(
          makeBlocked({
            reason: "no_upstream",
            message: "The current branch merge target is not a normal remote branch.",
            branch,
            upstream: null,
          }),
        );
      }

      const upstream = `${remoteName}/${remoteBranchName}`;
      yield* detectOperationInProgress(resolvedRootPath, branch, upstream);

      const statusResult = yield* runGitForSnapshot(resolvedRootPath, [
        "status",
        "--porcelain=v2",
        "--branch",
      ]);
      if (statusResult.exitCode !== 0) {
        return yield* Effect.fail(
          repositoryStateUnreadable(
            statusResult.stderr.trim() || "Unable to read Git status for the workspace.",
          ),
        );
      }

      const parsedStatus = parseGitStatusPorcelainV2(statusResult.stdout);
      if (parsedStatus.hasUnmergedChanges) {
        return yield* Effect.fail(
          makeBlocked({
            reason: "conflicts_present",
            message: "The repository has unresolved merge conflicts.",
            branch,
            upstream,
          }),
        );
      }

      const commitIdentityConfigured = yield* readCommitIdentityConfigured(resolvedRootPath);
      if (!commitIdentityConfigured && parsedStatus.hasLocalChanges) {
        return yield* Effect.fail(
          makeBlocked({
            reason: "commit_identity_missing",
            message:
              "Git user.name and user.email must be configured before sync can create a commit.",
            branch,
            upstream,
          }),
        );
      }

      return makeReady({
        repoRootPath,
        branch,
        upstream,
        remoteName,
        remoteBranchName,
        ahead: parsedStatus.ahead,
        behind: parsedStatus.behind,
        hasStagedChanges: parsedStatus.hasStagedChanges,
        hasUnstagedChanges: parsedStatus.hasUnstagedChanges,
        hasUntrackedChanges: parsedStatus.hasUntrackedChanges,
        hasLocalChanges: parsedStatus.hasLocalChanges,
        commitIdentityConfigured,
      });
    });

  const getSnapshot = (input: { readonly rootPath: string }): Effect.Effect<GitSyncSnapshot> =>
    getSnapshotEffect(input).pipe(
      Effect.catchAll((snapshotState) => Effect.succeed(snapshotState)),
    );

  const requireConfiguredRoot = (rootPath: string): Effect.Effect<string, GitSyncNotReadyError> =>
    Effect.gen(function* () {
      const settings = yield* settingsRepository.getSettings().pipe(
        Effect.mapError(
          (error) =>
            new GitSyncNotReadyError({
              message: `Unable to load desktop settings: ${toErrorMessage(error)}`,
            }),
        ),
      );

      if (settings.workspace.rootPath === null) {
        return yield* Effect.fail(
          new GitSyncNotReadyError({
            message: "Workspace root path is not configured.",
          }),
        );
      }

      const requestedRootPath = yield* canonicalizeRootPath(rootPath);
      const configuredRootPath = yield* canonicalizeRootPath(settings.workspace.rootPath);

      if (configuredRootPath !== requestedRootPath) {
        return yield* Effect.fail(
          new GitSyncNotReadyError({
            message: "Sync request does not match the currently configured workspace root.",
          }),
        );
      }

      return requestedRootPath;
    });

  const requireSyncableSnapshot = (
    rootPath: string,
  ): Effect.Effect<GitSyncReady, GitSyncNotReadyError> =>
    getSnapshotEffect({ rootPath }).pipe(
      Effect.mapError(
        (snapshotState) =>
          new GitSyncNotReadyError({
            message: toGitSyncSnapshotMessage(snapshotState) ?? "Git sync is not ready.",
          }),
      ),
    );

  const markDuplicateIndexDirty = () =>
    Effect.sync(() => {
      duplicateIndexInvalidation.markDuplicateIndexDirty();
    });

  const sync = (input: {
    readonly rootPath: string;
  }): Effect.Effect<
    GitSyncResult,
    | GitBinaryNotAvailableError
    | GitCommandTransportError
    | GitCommandFailedError
    | GitSyncConflictError
    | GitSyncNotReadyError
  > =>
    Effect.gen(function* () {
      const rootPath = yield* requireConfiguredRoot(input.rootPath);
      const initialSnapshot = yield* requireSyncableSnapshot(rootPath);

      const commitPhase = yield* mutationCoordinator.withWorkspaceLock(
        rootPath,
        Effect.gen(function* () {
          const lockedSnapshot = yield* requireSyncableSnapshot(rootPath);
          const addArgs = ["add", "-A", "."] as const;
          const addResult = yield* runGit(rootPath, addArgs);
          yield* expectExitCodes(addArgs, addResult, [0]);

          const diffArgs = ["diff", "--cached", "--quiet", "--exit-code"] as const;
          const diffResult = yield* runGit(rootPath, diffArgs);
          yield* expectExitCodes(diffArgs, diffResult, [0, 1]);

          if (diffResult.exitCode === 0) {
            return {
              createdCommit: false,
              commitHash: null,
            } satisfies CommitPhaseResult;
          }

          if (!lockedSnapshot.commitIdentityConfigured) {
            return yield* Effect.fail(
              new GitSyncNotReadyError({
                message:
                  "Git user.name and user.email must be configured before sync can create a commit.",
              }),
            );
          }

          const commitArgs = ["commit", "-m", "sync"] as const;
          const commitResult = yield* runGit(rootPath, commitArgs);
          yield* expectExitCodes(commitArgs, commitResult, [0]);

          const headArgs = ["rev-parse", "HEAD"] as const;
          const headResult = yield* runGit(rootPath, headArgs);
          yield* expectExitCodes(headArgs, headResult, [0]);

          return {
            createdCommit: true,
            commitHash: trimTrailingNewlines(headResult.stdout).trim(),
          } satisfies CommitPhaseResult;
        }),
      );

      const fetchArgs = ["fetch", "--prune", "--quiet", initialSnapshot.remoteName] as const;
      const fetchResult = yield* runGit(rootPath, fetchArgs);
      yield* expectExitCodes(fetchArgs, fetchResult, [0]);

      const integrationPhase = yield* mutationCoordinator.withWorkspaceLock(
        rootPath,
        Effect.gen(function* () {
          const lockedSnapshot = yield* requireSyncableSnapshot(rootPath);

          if (lockedSnapshot.hasLocalChanges) {
            return yield* Effect.fail(
              new GitSyncNotReadyError({
                message: "Workspace changed while sync was fetching remote updates. Retry sync.",
              }),
            );
          }

          if (lockedSnapshot.behind === 0) {
            return {
              rebased: false,
              snapshot: lockedSnapshot,
            } satisfies IntegrationPhaseResult;
          }

          const rebaseArgs = ["rebase", lockedSnapshot.upstream] as const;
          const rebaseResult = yield* runGit(rootPath, rebaseArgs);
          if (rebaseResult.exitCode !== 0) {
            yield* markDuplicateIndexDirty();

            const snapshotAfterFailedRebase = yield* getSnapshot({ rootPath });
            if (
              snapshotAfterFailedRebase._tag === "GitSyncBlocked" &&
              (snapshotAfterFailedRebase.reason === "git_operation_in_progress" ||
                snapshotAfterFailedRebase.reason === "conflicts_present")
            ) {
              return yield* Effect.fail(
                new GitSyncConflictError({
                  message:
                    "Git reported a conflict during rebase. Resolve the repository state outside the app and retry sync.",
                }),
              );
            }

            return yield* Effect.fail(commandFailedError(rebaseArgs, rebaseResult));
          }

          yield* markDuplicateIndexDirty();
          const rebasedSnapshot = yield* requireSyncableSnapshot(rootPath);

          return {
            rebased: true,
            snapshot: rebasedSnapshot,
          } satisfies IntegrationPhaseResult;
        }),
      );

      const pushed =
        integrationPhase.snapshot.ahead > 0
          ? yield* Effect.gen(function* () {
              const pushArgs = [
                "push",
                "--porcelain",
                integrationPhase.snapshot.remoteName,
                `HEAD:refs/heads/${integrationPhase.snapshot.remoteBranchName}`,
              ] as const;
              const pushResult = yield* runGit(rootPath, pushArgs);
              yield* expectExitCodes(pushArgs, pushResult, [0]);
              return true;
            })
          : false;

      const finalSnapshot = yield* getSnapshot({ rootPath });

      return {
        repoRootPath: initialSnapshot.repoRootPath,
        branch: initialSnapshot.branch,
        upstream: initialSnapshot.upstream,
        createdCommit: commitPhase.createdCommit,
        rebased: integrationPhase.rebased,
        pushed,
        commitHash: commitPhase.commitHash,
        snapshot: finalSnapshot,
      };
    });

  return {
    getSnapshot,
    sync,
  };
};

export { parseGitStatusPorcelainV2 };
