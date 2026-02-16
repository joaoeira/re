import { Schema } from "@effect/schema";
import { MetadataParseErrorSchema } from "@re/core";
import { ScanDecksErrorSchema, ScanDecksResultSchema } from "@re/workspace";
import { defineContract, rpc } from "electron-effect-rpc/contract";
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

export const appContract = defineContract({
  methods: [
    GetBootstrapData,
    ParseDeckPreview,
    ScanDecks,
    GetSettings,
    SetWorkspaceRootPath,
  ] as const,
  events: [] as const,
});

export type AppContract = typeof appContract;
