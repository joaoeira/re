import { Schema } from "@effect/schema";

export class SettingsReadFailed extends Schema.TaggedError<SettingsReadFailed>(
  "@re/desktop/settings/SettingsReadFailed",
)("SettingsReadFailed", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class SettingsDecodeFailed extends Schema.TaggedError<SettingsDecodeFailed>(
  "@re/desktop/settings/SettingsDecodeFailed",
)("SettingsDecodeFailed", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class SettingsWriteFailed extends Schema.TaggedError<SettingsWriteFailed>(
  "@re/desktop/settings/SettingsWriteFailed",
)("SettingsWriteFailed", {
  path: Schema.String,
  message: Schema.String,
}) {}

export class WorkspaceRootNotFound extends Schema.TaggedError<WorkspaceRootNotFound>(
  "@re/desktop/settings/WorkspaceRootNotFound",
)("WorkspaceRootNotFound", {
  rootPath: Schema.String,
}) {}

export class WorkspaceRootNotDirectory extends Schema.TaggedError<WorkspaceRootNotDirectory>(
  "@re/desktop/settings/WorkspaceRootNotDirectory",
)("WorkspaceRootNotDirectory", {
  rootPath: Schema.String,
}) {}

export class WorkspaceRootUnreadable extends Schema.TaggedError<WorkspaceRootUnreadable>(
  "@re/desktop/settings/WorkspaceRootUnreadable",
)("WorkspaceRootUnreadable", {
  rootPath: Schema.String,
  message: Schema.String,
}) {}

export const SettingsErrorSchema = Schema.Union(
  SettingsReadFailed,
  SettingsDecodeFailed,
  SettingsWriteFailed,
  WorkspaceRootNotFound,
  WorkspaceRootNotDirectory,
  WorkspaceRootUnreadable,
);

export type SettingsError = typeof SettingsErrorSchema.Type;
