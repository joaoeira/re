import { defineContract } from "electron-effect-rpc/contract";

import { AiGenerateText, AiStreamText } from "./contracts/ai";
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
import {
  ForgeCreateSession,
  ForgeExtractText,
  ForgeGenerateCardCloze,
  ForgeGenerateCardPermutations,
  ForgeGenerateSelectedTopicCards,
  ForgeGenerateTopicCards,
  ForgeGetCardCloze,
  ForgeGetCardPermutations,
  ForgeGetCardsSnapshot,
  ForgeGetTopicCards,
  ForgeGetTopicExtractionSnapshot,
  ForgeListSessions,
  ForgePreviewChunks,
  ForgeSaveTopicSelections,
  ForgeStartTopicExtraction,
  ForgeTopicChunkExtracted,
  ForgeUpdateCard,
  ForgeUpdatePermutation,
} from "./contracts/forge";
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
    AiGenerateText,
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
    ForgeListSessions,
    ForgePreviewChunks,
    ForgeStartTopicExtraction,
    ForgeGetTopicExtractionSnapshot,
    ForgeGetCardsSnapshot,
    ForgeGetTopicCards,
    ForgeGenerateTopicCards,
    ForgeGenerateSelectedTopicCards,
    ForgeGetCardPermutations,
    ForgeGenerateCardPermutations,
    ForgeGetCardCloze,
    ForgeGenerateCardCloze,
    ForgeUpdateCard,
    ForgeUpdatePermutation,
    ForgeSaveTopicSelections,
  ] as const,
  events: [
    WorkspaceSnapshotChanged,
    CardEdited,
    CardsDeleted,
    EditorNavigateRequest,
    ForgeTopicChunkExtracted,
  ] as const,
  streamMethods: [AiStreamText] as const,
});

export type AppContract = typeof appContract;
