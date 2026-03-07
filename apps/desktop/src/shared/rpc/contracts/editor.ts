import { Schema } from "@effect/schema";
import { event, rpc } from "electron-effect-rpc/contract";

import {
  EditorOperationError,
  ImportDeckImageAssetInputSchema,
  ImportedDeckImageAssetResultSchema,
} from "@shared/rpc/schemas/editor";

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

const DeleteItemSchema = Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
});

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

export const DeleteItems = rpc(
  "DeleteItems",
  Schema.Struct({
    items: Schema.NonEmptyArray(DeleteItemSchema),
  }),
  Schema.Struct({}),
  EditorOperationError,
);

export const ImportDeckImageAsset = rpc(
  "ImportDeckImageAsset",
  ImportDeckImageAssetInputSchema,
  ImportedDeckImageAssetResultSchema,
  EditorOperationError,
);

export const OpenEditorWindow = rpc(
  "OpenEditorWindow",
  EditorWindowParamsSchema,
  Schema.Struct({}),
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
