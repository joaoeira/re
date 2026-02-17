import { Schema } from "@effect/schema";
import { MetadataParseErrorSchema } from "@re/core";
import {
  ScanDecksErrorSchema,
  ScanDecksResultSchema,
  SnapshotWorkspaceErrorSchema,
  SnapshotWorkspaceResultSchema,
} from "@re/workspace";
import { defineContract, event, rpc } from "electron-effect-rpc/contract";
import {
  SettingsErrorSchema,
  SettingsSchemaV1,
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

export const GetSettings = rpc(
  "GetSettings",
  Schema.Struct({}),
  SettingsSchemaV1,
  SettingsErrorSchema,
);

export const SetWorkspaceRootPath = rpc(
  "SetWorkspaceRootPath",
  SetWorkspaceRootPathInputSchema,
  SettingsSchemaV1,
  SettingsErrorSchema,
);

export const WorkspaceSnapshotChanged = event(
  "WorkspaceSnapshotChanged",
  SnapshotWorkspaceResultSchema,
);

export const appContract = defineContract({
  methods: [
    GetBootstrapData,
    ParseDeckPreview,
    ScanDecks,
    GetWorkspaceSnapshot,
    GetSettings,
    SetWorkspaceRootPath,
  ] as const,
  events: [WorkspaceSnapshotChanged] as const,
});

export type AppContract = typeof appContract;
