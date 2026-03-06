import { Schema } from "@effect/schema";

import type { GitSyncBlocked, GitSyncSnapshot, GitSyncReady, GitSyncUnavailable } from "./schema";

export class GitCommandTransportError extends Schema.TaggedError<GitCommandTransportError>(
  "@re/desktop/git/GitCommandTransportError",
)("GitCommandTransportError", {
  command: Schema.Array(Schema.String),
  message: Schema.String,
}) {}

export class GitSyncNotReadyError extends Schema.TaggedError<GitSyncNotReadyError>(
  "@re/desktop/git/GitSyncNotReadyError",
)("GitSyncNotReadyError", {
  message: Schema.String,
}) {}

export class GitBinaryNotAvailableError extends Schema.TaggedError<GitBinaryNotAvailableError>(
  "@re/desktop/git/GitBinaryNotAvailableError",
)("GitBinaryNotAvailableError", {
  message: Schema.String,
}) {}

export class GitCommandFailedError extends Schema.TaggedError<GitCommandFailedError>(
  "@re/desktop/git/GitCommandFailedError",
)("GitCommandFailedError", {
  command: Schema.Array(Schema.String),
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
}) {}

export class GitSyncConflictError extends Schema.TaggedError<GitSyncConflictError>(
  "@re/desktop/git/GitSyncConflictError",
)("GitSyncConflictError", {
  message: Schema.String,
}) {}

export const GitSyncErrorSchema = Schema.Union(
  GitCommandTransportError,
  GitSyncNotReadyError,
  GitBinaryNotAvailableError,
  GitCommandFailedError,
  GitSyncConflictError,
);

export type GitSyncError = typeof GitSyncErrorSchema.Type;

export const toGitSyncSnapshotMessage = (
  snapshot: GitSyncUnavailable | GitSyncBlocked | GitSyncReady,
): string | null => {
  if (snapshot._tag === "GitSyncReady") {
    return snapshot.commitIdentityConfigured
      ? null
      : "Git commit identity is missing. Sync can pull or push existing commits, but it cannot create a new commit.";
  }

  return snapshot.message;
};

export const gitSyncSnapshotHasWork = (snapshot: GitSyncSnapshot): boolean => {
  if (snapshot._tag !== "GitSyncReady") {
    return false;
  }

  return snapshot.hasLocalChanges || snapshot.ahead > 0 || snapshot.behind > 0;
};

export const toGitSyncErrorMessage = (error: GitSyncError): string => {
  switch (error._tag) {
    case "GitCommandTransportError":
      return `Unable to run ${error.command.join(" ")}: ${error.message}`;
    case "GitSyncNotReadyError":
      return error.message;
    case "GitBinaryNotAvailableError":
      return error.message;
    case "GitCommandFailedError":
      return error.stderr.trim() || error.stdout.trim() || `${error.command.join(" ")} failed.`;
    case "GitSyncConflictError":
      return error.message;
  }
};

export const mapGitSyncErrorToError = (error: GitSyncError | Error): Error =>
  "_tag" in error ? new Error(toGitSyncErrorMessage(error)) : error;
