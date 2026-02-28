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

export const toCreateDeckErrorMessage = (error: CreateDeckError): string => {
  switch (error._tag) {
    case "workspace_root_not_configured":
      return error.message;
    case "InvalidDeckPath":
      return `Invalid deck path "${error.inputPath}" (${error.reason}).`;
    case "DeckAlreadyExists":
      return `Deck already exists: ${error.deckPath}`;
    case "DeckFileOperationError":
      return `Unable to ${error.operation} deck: ${error.message}`;
  }
};

export const mapCreateDeckErrorToError = (error: CreateDeckError | Error): Error =>
  "_tag" in error ? new Error(toCreateDeckErrorMessage(error)) : error;
