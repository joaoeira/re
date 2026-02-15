import * as S from "@effect/schema/Schema";
import { defineContract, rpc } from "electron-effect-rpc/contract";

export const AppRpcError = S.Struct({
  code: S.String,
  message: S.String,
});

export const GetBootstrapData = rpc(
  "GetBootstrapData",
  S.Struct({}),
  S.Struct({
    appName: S.String,
    message: S.String,
    timestamp: S.String,
  }),
  AppRpcError,
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
  AppRpcError,
);

export const appContract = defineContract({
  methods: [GetBootstrapData, ParseDeckPreview] as const,
  events: [] as const,
});
