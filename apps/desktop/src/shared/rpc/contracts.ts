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
import {
  BuildReviewQueueResultSchema,
  CardContentErrorSchema,
  CardContentResultSchema,
  FSRSGradeSchema,
  ReviewOperationError,
  SerializedItemMetadataSchema,
} from "@shared/rpc/schemas/review";

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

export const BuildReviewQueue = rpc(
  "BuildReviewQueue",
  Schema.Struct({
    deckPaths: Schema.Array(Schema.String),
    rootPath: Schema.String,
  }),
  BuildReviewQueueResultSchema,
  ReviewOperationError,
);

export const GetCardContent = rpc(
  "GetCardContent",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
    cardIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  }),
  CardContentResultSchema,
  CardContentErrorSchema,
);

export const ScheduleReview = rpc(
  "ScheduleReview",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
    grade: FSRSGradeSchema,
  }),
  Schema.Struct({
    previousCard: SerializedItemMetadataSchema,
  }),
  ReviewOperationError,
);

export const UndoReview = rpc(
  "UndoReview",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
    previousCard: SerializedItemMetadataSchema,
  }),
  Schema.Struct({}),
  ReviewOperationError,
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
    BuildReviewQueue,
    GetCardContent,
    ScheduleReview,
    UndoReview,
  ] as const,
  events: [WorkspaceSnapshotChanged] as const,
});

export type AppContract = typeof appContract;
