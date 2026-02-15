import * as S from "@effect/schema/Schema";
import { MetadataParseErrorSchema } from "@re/core";
import { ScanDecksErrorSchema, ScanDecksResultSchema } from "@re/workspace";
import { defineContract, rpc } from "electron-effect-rpc/contract";

export const GetBootstrapData = rpc(
  "GetBootstrapData",
  S.Struct({}),
  S.Struct({
    appName: S.String,
    message: S.String,
    timestamp: S.String,
  }),
);

export const ParseDeckPreview = rpc(
  "ParseDeckPreview",
  S.Struct({
    markdown: S.String,
  }),
  S.Struct({
    items: S.Number,
    cards: S.Number,
  }),
  MetadataParseErrorSchema,
);

export const ScanDecks = rpc(
  "ScanDecks",
  S.Struct({
    rootPath: S.String,
  }),
  ScanDecksResultSchema,
  ScanDecksErrorSchema,
);

export const appContract = defineContract({
  methods: [GetBootstrapData, ParseDeckPreview, ScanDecks] as const,
  events: [] as const,
});
