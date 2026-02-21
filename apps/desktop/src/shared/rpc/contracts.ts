import { Schema } from "@effect/schema";
import { MetadataParseErrorSchema } from "@re/core";
import {
  ScanDecksErrorSchema,
  ScanDecksResultSchema,
  SnapshotWorkspaceErrorSchema,
  SnapshotWorkspaceResultSchema,
} from "@re/workspace";
import { defineContract, event, rpc } from "electron-effect-rpc/contract";
import { EditorOperationError } from "@shared/rpc/schemas/editor";
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
  ReviewHistoryEntrySchema,
  ReviewOperationError,
  ReviewStatsSchema,
  SerializedItemMetadataSchema,
  UndoReviewErrorSchema,
} from "@shared/rpc/schemas/review";

const EditorCardTypeSchema = Schema.Literal("qa", "cloze");

const EditorCreateWindowParamsSchema = Schema.Struct({
  mode: Schema.Literal("create"),
  deckPath: Schema.optional(Schema.String),
});

const EditorEditWindowParamsSchema = Schema.Struct({
  mode: Schema.Literal("edit"),
  deckPath: Schema.String,
  cardId: Schema.String,
});

const EditorWindowParamsSchema = Schema.Union(
  EditorCreateWindowParamsSchema,
  EditorEditWindowParamsSchema,
);

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
    reviewEntryId: Schema.Union(Schema.Number.pipe(Schema.int(), Schema.positive()), Schema.Null),
    expectedCurrentCardFingerprint: Schema.String,
    previousCardFingerprint: Schema.String,
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
    reviewEntryId: Schema.Union(Schema.Number.pipe(Schema.int(), Schema.positive()), Schema.Null),
    expectedCurrentCardFingerprint: Schema.String,
    previousCardFingerprint: Schema.String,
  }),
  Schema.Struct({}),
  UndoReviewErrorSchema,
);

export const GetReviewStats = rpc(
  "GetReviewStats",
  Schema.Struct({
    rootPath: Schema.String,
    includeUndone: Schema.optional(Schema.Boolean),
  }),
  ReviewStatsSchema,
  ReviewOperationError,
);

export const ListReviewHistory = rpc(
  "ListReviewHistory",
  Schema.Struct({
    rootPath: Schema.String,
    includeUndone: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
    offset: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  }),
  Schema.Struct({
    entries: Schema.Array(ReviewHistoryEntrySchema),
  }),
  ReviewOperationError,
);

export const AppendItem = rpc(
  "AppendItem",
  Schema.Struct({
    deckPath: Schema.String,
    content: Schema.String,
    cardType: EditorCardTypeSchema,
  }),
  Schema.Struct({
    cardIds: Schema.Array(Schema.String),
  }),
  EditorOperationError,
);

export const ReplaceItem = rpc(
  "ReplaceItem",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
    content: Schema.String,
    cardType: EditorCardTypeSchema,
  }),
  Schema.Struct({
    cardIds: Schema.Array(Schema.String),
  }),
  EditorOperationError,
);

export const GetItemForEdit = rpc(
  "GetItemForEdit",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
  }),
  Schema.Struct({
    content: Schema.String,
    cardType: EditorCardTypeSchema,
    cardIds: Schema.Array(Schema.String),
  }),
  EditorOperationError,
);

export const CheckDuplicates = rpc(
  "CheckDuplicates",
  Schema.Struct({
    content: Schema.String,
    cardType: EditorCardTypeSchema,
    rootPath: Schema.String,
    excludeCardIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    isDuplicate: Schema.Boolean,
    matchingDeckPath: Schema.optionalWith(Schema.String, { as: "Option" }),
  }),
  EditorOperationError,
);

export const OpenEditorWindow = rpc(
  "OpenEditorWindow",
  EditorWindowParamsSchema,
  Schema.Struct({}),
);

export const WorkspaceSnapshotChanged = event(
  "WorkspaceSnapshotChanged",
  SnapshotWorkspaceResultSchema,
);

export const CardEdited = event(
  "CardEdited",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
  }),
);

export const EditorNavigateRequest = event("EditorNavigateRequest", EditorWindowParamsSchema);

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
    GetReviewStats,
    ListReviewHistory,
    AppendItem,
    ReplaceItem,
    GetItemForEdit,
    CheckDuplicates,
    OpenEditorWindow,
  ] as const,
  events: [WorkspaceSnapshotChanged, CardEdited, EditorNavigateRequest] as const,
});

export type AppContract = typeof appContract;
