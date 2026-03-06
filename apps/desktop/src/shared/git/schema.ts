import { Schema } from "@effect/schema";

const NullableString = Schema.Union(Schema.String, Schema.Null);

export const GitSyncUnavailableReasonSchema = Schema.Literal(
  "workspace_root_not_configured",
  "git_not_installed",
  "not_a_repository",
  "workspace_root_is_not_repo_root",
  "repository_state_unreadable",
);

export type GitSyncUnavailableReason = typeof GitSyncUnavailableReasonSchema.Type;

export const GitSyncBlockedReasonSchema = Schema.Literal(
  "detached_head",
  "no_upstream",
  "commit_identity_missing",
  "git_operation_in_progress",
  "conflicts_present",
);

export type GitSyncBlockedReason = typeof GitSyncBlockedReasonSchema.Type;

export const GitSyncUnavailableSchema = Schema.Struct({
  _tag: Schema.Literal("GitSyncUnavailable"),
  reason: GitSyncUnavailableReasonSchema,
  message: Schema.String,
});

export type GitSyncUnavailable = typeof GitSyncUnavailableSchema.Type;

export const GitSyncBlockedSchema = Schema.Struct({
  _tag: Schema.Literal("GitSyncBlocked"),
  reason: GitSyncBlockedReasonSchema,
  message: Schema.String,
  branch: NullableString,
  upstream: NullableString,
});

export type GitSyncBlocked = typeof GitSyncBlockedSchema.Type;

export const GitSyncReadySchema = Schema.Struct({
  _tag: Schema.Literal("GitSyncReady"),
  repoRootPath: Schema.String,
  branch: Schema.String,
  upstream: Schema.String,
  remoteName: Schema.String,
  remoteBranchName: Schema.String,
  ahead: Schema.Number,
  behind: Schema.Number,
  hasStagedChanges: Schema.Boolean,
  hasUnstagedChanges: Schema.Boolean,
  hasUntrackedChanges: Schema.Boolean,
  hasLocalChanges: Schema.Boolean,
  commitIdentityConfigured: Schema.Boolean,
});

export type GitSyncReady = typeof GitSyncReadySchema.Type;

export const GitSyncSnapshotSchema = Schema.Union(
  GitSyncUnavailableSchema,
  GitSyncBlockedSchema,
  GitSyncReadySchema,
);

export type GitSyncSnapshot = typeof GitSyncSnapshotSchema.Type;

export const GitSyncResultSchema = Schema.Struct({
  repoRootPath: Schema.String,
  branch: Schema.String,
  upstream: Schema.String,
  createdCommit: Schema.Boolean,
  rebased: Schema.Boolean,
  pushed: Schema.Boolean,
  commitHash: NullableString,
  snapshot: GitSyncSnapshotSchema,
});

export type GitSyncResult = typeof GitSyncResultSchema.Type;
