import { defineContract } from "electron-effect-rpc/contract";

import { GenerateCompletion, StreamCompletion } from "./contracts/ai";
import {
  AppendItem,
  CardEdited,
  CardsDeleted,
  CheckDuplicates,
  DeleteItems,
  EditorNavigateRequest,
  GetItemForEdit,
  OpenEditorWindow,
  ReplaceItem,
} from "./contracts/editor";
import { ForgeCreateSession, ForgeExtractText } from "./contracts/forge";
import {
  BuildReviewQueue,
  GetCardContent,
  GetReviewStats,
  ListReviewHistory,
  ScheduleReview,
  UndoReview,
} from "./contracts/review";
import { DeleteApiKey, HasApiKey, SetApiKey } from "./contracts/secret";
import {
  CreateDeck,
  DeleteDeck,
  GetBootstrapData,
  GetSettings,
  GetWorkspaceSnapshot,
  ParseDeckPreview,
  RenameDeck,
  ScanDecks,
  SelectDirectory,
  SetWorkspaceRootPath,
  WorkspaceSnapshotChanged,
} from "./contracts/workspace";

export * from "./contracts/ai";
export * from "./contracts/editor";
export * from "./contracts/forge";
export * from "./contracts/review";
export * from "./contracts/secret";
export * from "./contracts/workspace";

export const appContract = defineContract({
  methods: [
    GenerateCompletion,
    GetBootstrapData,
    ParseDeckPreview,
    ScanDecks,
    GetWorkspaceSnapshot,
    CreateDeck,
    DeleteDeck,
    RenameDeck,
    GetSettings,
    SetWorkspaceRootPath,
    HasApiKey,
    SetApiKey,
    DeleteApiKey,
    SelectDirectory,
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
    ForgeCreateSession,
    ForgeExtractText,
  ] as const,
  events: [WorkspaceSnapshotChanged, CardEdited, CardsDeleted, EditorNavigateRequest] as const,
  streamMethods: [StreamCompletion] as const,
});

export type AppContract = typeof appContract;
