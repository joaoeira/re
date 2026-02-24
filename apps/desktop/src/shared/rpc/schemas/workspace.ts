import { Schema } from "@effect/schema";
import {
  DeckAlreadyExists,
  DeckFileNotFound,
  DeckFileOperationError,
  InvalidDeckPath,
} from "@re/workspace";

export class WorkspaceRootPathNotConfiguredError extends Schema.TaggedError<WorkspaceRootPathNotConfiguredError>(
  "@re/desktop/rpc/WorkspaceRootPathNotConfiguredError",
)("workspace_root_not_configured", {
  message: Schema.String,
}) {}

export const CreateDeckErrorSchema = Schema.Union(
  WorkspaceRootPathNotConfiguredError,
  InvalidDeckPath,
  DeckAlreadyExists,
  DeckFileOperationError,
);

export const DeleteDeckErrorSchema = Schema.Union(
  WorkspaceRootPathNotConfiguredError,
  InvalidDeckPath,
  DeckFileNotFound,
  DeckFileOperationError,
);

export const RenameDeckErrorSchema = Schema.Union(
  WorkspaceRootPathNotConfiguredError,
  InvalidDeckPath,
  DeckAlreadyExists,
  DeckFileNotFound,
  DeckFileOperationError,
);

export type CreateDeckError = typeof CreateDeckErrorSchema.Type;
export type DeleteDeckError = typeof DeleteDeckErrorSchema.Type;
export type RenameDeckError = typeof RenameDeckErrorSchema.Type;
