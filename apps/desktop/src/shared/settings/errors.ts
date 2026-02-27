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

export const toSettingsErrorMessage = (error: SettingsError): string => {
  switch (error._tag) {
    case "SettingsReadFailed":
      return `Unable to read settings at ${error.path}: ${error.message}`;
    case "SettingsDecodeFailed":
      return `Settings file is invalid at ${error.path}: ${error.message}`;
    case "SettingsWriteFailed":
      return `Unable to write settings at ${error.path}: ${error.message}`;
    case "WorkspaceRootNotFound":
      return `Workspace root not found: ${error.rootPath}`;
    case "WorkspaceRootNotDirectory":
      return `Workspace root is not a directory: ${error.rootPath}`;
    case "WorkspaceRootUnreadable":
      return `Workspace root is unreadable: ${error.message}`;
  }
};

export const mapSettingsErrorToError = (error: SettingsError | Error): Error =>
  "_tag" in error ? new Error(toSettingsErrorMessage(error)) : error;
