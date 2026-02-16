import * as S from "@effect/schema/Schema";

export class SettingsReadFailed extends S.TaggedError<SettingsReadFailed>(
  "@re/desktop/settings/SettingsReadFailed",
)("SettingsReadFailed", {
  path: S.String,
  message: S.String,
}) {}

export class SettingsDecodeFailed extends S.TaggedError<SettingsDecodeFailed>(
  "@re/desktop/settings/SettingsDecodeFailed",
)("SettingsDecodeFailed", {
  path: S.String,
  message: S.String,
}) {}

export class SettingsWriteFailed extends S.TaggedError<SettingsWriteFailed>(
  "@re/desktop/settings/SettingsWriteFailed",
)("SettingsWriteFailed", {
  path: S.String,
  message: S.String,
}) {}

export class WorkspaceRootNotFound extends S.TaggedError<WorkspaceRootNotFound>(
  "@re/desktop/settings/WorkspaceRootNotFound",
)("WorkspaceRootNotFound", {
  rootPath: S.String,
}) {}

export class WorkspaceRootNotDirectory extends S.TaggedError<WorkspaceRootNotDirectory>(
  "@re/desktop/settings/WorkspaceRootNotDirectory",
)("WorkspaceRootNotDirectory", {
  rootPath: S.String,
}) {}

export class WorkspaceRootUnreadable extends S.TaggedError<WorkspaceRootUnreadable>(
  "@re/desktop/settings/WorkspaceRootUnreadable",
)("WorkspaceRootUnreadable", {
  rootPath: S.String,
  message: S.String,
}) {}

export const SettingsErrorSchema = S.Union(
  SettingsReadFailed,
  SettingsDecodeFailed,
  SettingsWriteFailed,
  WorkspaceRootNotFound,
  WorkspaceRootNotDirectory,
  WorkspaceRootUnreadable,
);

export type SettingsError = S.Schema.Type<typeof SettingsErrorSchema>;
