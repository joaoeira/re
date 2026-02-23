import { Schema } from "@effect/schema";
import { MetadataParseErrorSchema } from "@re/core";
import {
  ScanDecksErrorSchema,
  ScanDecksResultSchema,
  SnapshotWorkspaceErrorSchema,
  SnapshotWorkspaceResultSchema,
} from "@re/workspace";
import { defineContract, event, rpc, streamRpc } from "electron-effect-rpc/contract";
import { AiStreamChunkSchema, AiStreamErrorSchema, ModelIdSchema } from "@shared/rpc/schemas/ai";
import { EditorOperationError } from "@shared/rpc/schemas/editor";
import {
  SettingsErrorSchema,
  SettingsSchemaV1,
  SetWorkspaceRootPathInputSchema,
} from "@shared/settings";
import { SecretKeySchema, SecretStoreErrorSchema } from "@shared/secrets";
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

export const StreamCompletion = streamRpc(
  "StreamCompletion",
  Schema.Struct({
    model: ModelIdSchema,
    prompt: Schema.String,
    systemPrompt: Schema.optional(Schema.String),
  }),
  AiStreamChunkSchema,
  AiStreamErrorSchema,
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

export const HasApiKey = rpc(
  "HasApiKey",
  Schema.Struct({
    key: SecretKeySchema,
  }),
  Schema.Struct({
    configured: Schema.Boolean,
  }),
  SecretStoreErrorSchema,
);

export const SetApiKey = rpc(
  "SetApiKey",
  Schema.Struct({
    key: SecretKeySchema,
    value: Schema.String,
  }),
  Schema.Struct({
    success: Schema.Boolean,
  }),
  SecretStoreErrorSchema,
);

export const DeleteApiKey = rpc(
  "DeleteApiKey",
  Schema.Struct({
    key: SecretKeySchema,
  }),
  Schema.Struct({
    success: Schema.Boolean,
  }),
  SecretStoreErrorSchema,
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

const DeleteItemSchema = Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
});

export const DeleteItems = rpc(
  "DeleteItems",
  Schema.Struct({
    items: Schema.NonEmptyArray(DeleteItemSchema),
  }),
  Schema.Struct({}),
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

export const CardsDeleted = event(
  "CardsDeleted",
  Schema.Struct({
    items: Schema.Array(DeleteItemSchema),
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
    HasApiKey,
    SetApiKey,
    DeleteApiKey,
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
    DeleteItems,
    OpenEditorWindow,
  ] as const,
  events: [WorkspaceSnapshotChanged, CardEdited, CardsDeleted, EditorNavigateRequest] as const,
  streamMethods: [StreamCompletion] as const,
});

export type AppContract = typeof appContract;
