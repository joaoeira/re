import { Schema } from "@effect/schema";
import { MetadataParseErrorSchema } from "@re/core";
import {
  ScanDecksErrorSchema,
  ScanDecksResultSchema,
  SnapshotWorkspaceErrorSchema,
  SnapshotWorkspaceResultSchema,
} from "@re/workspace";
import { event, rpc } from "electron-effect-rpc/contract";

import {
  CreateDeckErrorSchema,
  DeleteDeckErrorSchema,
  RenameDeckErrorSchema,
} from "@shared/rpc/schemas/workspace";
import {
  SettingsErrorSchema,
  SettingsSchemaV2,
  SetWorkspaceRootPathInputSchema,
} from "@shared/settings";

export const GetBootstrapData = rpc(
  "GetBootstrapData",
  Schema.Struct({}),
  Schema.Struct({
    appName: Schema.String,
    message: Schema.String,
    timestamp: Schema.String,
  }),
);

export const ParseDeckPreview = rpc(
  "ParseDeckPreview",
  Schema.Struct({
    markdown: Schema.String,
  }),
  Schema.Struct({
    items: Schema.Number,
    cards: Schema.Number,
  }),
  MetadataParseErrorSchema,
);

export const ScanDecks = rpc(
  "ScanDecks",
  Schema.Struct({
    rootPath: Schema.String,
  }),
  ScanDecksResultSchema,
  ScanDecksErrorSchema,
);

export const GetWorkspaceSnapshot = rpc(
  "GetWorkspaceSnapshot",
  Schema.Struct({
    rootPath: Schema.String,
    options: Schema.Struct({
      includeHidden: Schema.Boolean,
      extraIgnorePatterns: Schema.Array(Schema.String),
    }),
  }),
  SnapshotWorkspaceResultSchema,
  SnapshotWorkspaceErrorSchema,
);

export const CreateDeck = rpc(
  "CreateDeck",
  Schema.Struct({
    relativePath: Schema.String,
    createParents: Schema.optional(Schema.Boolean),
    initialContent: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    absolutePath: Schema.String,
  }),
  CreateDeckErrorSchema,
);

export const DeleteDeck = rpc(
  "DeleteDeck",
  Schema.Struct({
    relativePath: Schema.String,
  }),
  Schema.Struct({}),
  DeleteDeckErrorSchema,
);

export const RenameDeck = rpc(
  "RenameDeck",
  Schema.Struct({
    fromRelativePath: Schema.String,
    toRelativePath: Schema.String,
    createParents: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    absolutePath: Schema.String,
  }),
  RenameDeckErrorSchema,
);

export const GetSettings = rpc(
  "GetSettings",
  Schema.Struct({}),
  SettingsSchemaV2,
  SettingsErrorSchema,
);

export const SetWorkspaceRootPath = rpc(
  "SetWorkspaceRootPath",
  SetWorkspaceRootPathInputSchema,
  SettingsSchemaV2,
  SettingsErrorSchema,
);

export const SelectDirectory = rpc(
  "SelectDirectory",
  Schema.Struct({}),
  Schema.Struct({
    path: Schema.Union(Schema.String, Schema.Null),
  }),
);

export const WorkspaceSnapshotChanged = event(
  "WorkspaceSnapshotChanged",
  SnapshotWorkspaceResultSchema,
);
