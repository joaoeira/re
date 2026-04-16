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
  ImportDeckImageAsset,
  OpenEditorWindow,
  ReplaceItem,
} from "./contracts/editor";
import {
  ForgeAddCardToDeck,
  ForgeCreateSession,
  ForgeExtractText,
  ForgeGenerateCardCloze,
  ForgeGenerateDerivedCards,
  ForgeGenerateSelectedTopicCards,
  ForgeGenerateTopicCards,
  ForgeReformulateCard,
  ForgeGetCardCloze,
  ForgeGetDerivedCards,
  ForgeGetCardsSnapshot,
  ForgeGetTopicCards,
  ForgeGetTopicExtractionSnapshot,
  ForgeListSessions,
  ForgePreviewChunks,
  ForgeSaveTopicSelections,
  ForgeSetSessionDeckPath,
  ForgeStartTopicExtraction,
  ForgeTopicChunkExtracted,
  ForgeExtractionSessionCreated,
  ForgeUpdateCard,
  ForgeUpdateDerivation,
} from "./contracts/forge";
import { GetGitSyncSnapshot, RunGitSync } from "./contracts/git";
import {
  BuildReviewQueue,
  GetCardContent,
  GetReviewAssistantSourceCard,
  GetReviewStats,
  ListReviewHistory,
  ReviewGeneratePermutations,
  ScheduleReview,
  UndoReview,
} from "./contracts/review";
import { DeleteApiKey, HasApiKey, SetApiKey } from "./contracts/secret";
import {
  GetSettings,
  ListAiModels,
  ListPromptTasks,
  SelectDirectory,
  SetDefaultModelKey,
  SetPromptModelOverride,
  SetWorkspaceRootPath,
} from "./contracts/settings";
import {
  CreateDeck,
  DeleteDeck,
  GetBootstrapData,
  GetWorkspaceSnapshot,
  ParseDeckPreview,
  RenameDeck,
  ScanDecks,
  WorkspaceSnapshotChanged,
} from "./contracts/workspace";

export * from "./contracts/ai";
export * from "./contracts/editor";
export * from "./contracts/forge";
export * from "./contracts/git";
export * from "./contracts/review";
export * from "./contracts/secret";
export * from "./contracts/settings";
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
    ListAiModels,
    ListPromptTasks,
    SetDefaultModelKey,
    SetPromptModelOverride,
    HasApiKey,
    SetApiKey,
    DeleteApiKey,
    SelectDirectory,
    BuildReviewQueue,
    GetCardContent,
    GetReviewAssistantSourceCard,
    ReviewGeneratePermutations,
    ScheduleReview,
    UndoReview,
    GetReviewStats,
    ListReviewHistory,
    AppendItem,
    ReplaceItem,
    GetItemForEdit,
    CheckDuplicates,
    DeleteItems,
    ImportDeckImageAsset,
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
    ForgeGetDerivedCards,
    ForgeGenerateDerivedCards,
    ForgeGetCardCloze,
    ForgeGenerateCardCloze,
    ForgeReformulateCard,
    ForgeUpdateCard,
    ForgeUpdateDerivation,
    ForgeSaveTopicSelections,
    ForgeSetSessionDeckPath,
    ForgeAddCardToDeck,
    GetGitSyncSnapshot,
    RunGitSync,
  ] as const,
  events: [
    WorkspaceSnapshotChanged,
    CardEdited,
    CardsDeleted,
    EditorNavigateRequest,
    ForgeTopicChunkExtracted,
    ForgeExtractionSessionCreated,
  ] as const,
  streamMethods: [AiStreamText] as const,
});

export type AppContract = typeof appContract;
