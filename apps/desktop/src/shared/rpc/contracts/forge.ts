import { event, rpc } from "electron-effect-rpc/contract";

import {
  ForgeCreateSessionErrorSchema,
  ForgeCreateSessionInputSchema,
  ForgeCreateSessionResultSchema,
  ForgeGenerateDerivedCardsErrorSchema,
  ForgeGenerateDerivedCardsInputSchema,
  ForgeGenerateDerivedCardsResultSchema,
  ForgeListSessionsErrorSchema,
  ForgeListSessionsInputSchema,
  ForgeListSessionsResultSchema,
  ForgeGenerateCardClozeErrorSchema,
  ForgeGenerateCardClozeInputSchema,
  ForgeGenerateCardClozeResultSchema,
  ForgeReformulateCardErrorSchema,
  ForgeReformulateCardInputSchema,
  ForgeReformulateCardResultSchema,
  ForgeGenerateSelectedTopicCardsErrorSchema,
  ForgeGenerateSelectedTopicCardsInputSchema,
  ForgeGenerateSelectedTopicCardsResultSchema,
  ForgeGenerateTopicCardsErrorSchema,
  ForgeGenerateTopicCardsInputSchema,
  ForgeGenerateTopicCardsResultSchema,
  ForgeGetCardClozeErrorSchema,
  ForgeGetCardClozeInputSchema,
  ForgeGetCardClozeResultSchema,
  ForgeGetCardsSnapshotErrorSchema,
  ForgeGetCardsSnapshotInputSchema,
  ForgeGetCardsSnapshotResultSchema,
  ForgeGetDerivedCardsErrorSchema,
  ForgeGetDerivedCardsInputSchema,
  ForgeGetDerivedCardsResultSchema,
  ForgeGetTopicCardsErrorSchema,
  ForgeGetTopicCardsInputSchema,
  ForgeGetTopicCardsResultSchema,
  ForgeExtractTextErrorSchema,
  ForgeExtractTextInputSchema,
  ForgeExtractTextResultSchema,
  ForgeGetTopicExtractionSnapshotErrorSchema,
  ForgeGetTopicExtractionSnapshotInputSchema,
  ForgeGetTopicExtractionSnapshotResultSchema,
  ForgePreviewChunksErrorSchema,
  ForgePreviewChunksInputSchema,
  ForgePreviewChunksResultSchema,
  ForgeStartTopicExtractionErrorSchema,
  ForgeStartTopicExtractionInputSchema,
  ForgeStartTopicExtractionResultSchema,
  ForgeTopicChunkExtractedEventSchema,
  ForgeExtractionSessionCreatedEventSchema,
  ForgeUpdateCardErrorSchema,
  ForgeUpdateCardInputSchema,
  ForgeUpdateCardResultSchema,
  ForgeUpdateDerivationErrorSchema,
  ForgeUpdateDerivationInputSchema,
  ForgeUpdateDerivationResultSchema,
  ForgeSaveTopicSelectionsErrorSchema,
  ForgeSaveTopicSelectionsInputSchema,
  ForgeSaveTopicSelectionsResultSchema,
  ForgeSetSessionDeckPathErrorSchema,
  ForgeSetSessionDeckPathInputSchema,
  ForgeSetSessionDeckPathResultSchema,
  ForgeAddCardToDeckErrorSchema,
  ForgeAddCardToDeckInputSchema,
  ForgeAddCardToDeckResultSchema,
} from "@shared/rpc/schemas/forge";

export const ForgeCreateSession = rpc(
  "ForgeCreateSession",
  ForgeCreateSessionInputSchema,
  ForgeCreateSessionResultSchema,
  ForgeCreateSessionErrorSchema,
);

export const ForgeExtractText = rpc(
  "ForgeExtractText",
  ForgeExtractTextInputSchema,
  ForgeExtractTextResultSchema,
  ForgeExtractTextErrorSchema,
);

export const ForgePreviewChunks = rpc(
  "ForgePreviewChunks",
  ForgePreviewChunksInputSchema,
  ForgePreviewChunksResultSchema,
  ForgePreviewChunksErrorSchema,
);

export const ForgeStartTopicExtraction = rpc(
  "ForgeStartTopicExtraction",
  ForgeStartTopicExtractionInputSchema,
  ForgeStartTopicExtractionResultSchema,
  ForgeStartTopicExtractionErrorSchema,
);

export const ForgeGetTopicExtractionSnapshot = rpc(
  "ForgeGetTopicExtractionSnapshot",
  ForgeGetTopicExtractionSnapshotInputSchema,
  ForgeGetTopicExtractionSnapshotResultSchema,
  ForgeGetTopicExtractionSnapshotErrorSchema,
);

export const ForgeGetCardsSnapshot = rpc(
  "ForgeGetCardsSnapshot",
  ForgeGetCardsSnapshotInputSchema,
  ForgeGetCardsSnapshotResultSchema,
  ForgeGetCardsSnapshotErrorSchema,
);

export const ForgeGetTopicCards = rpc(
  "ForgeGetTopicCards",
  ForgeGetTopicCardsInputSchema,
  ForgeGetTopicCardsResultSchema,
  ForgeGetTopicCardsErrorSchema,
);

export const ForgeGenerateTopicCards = rpc(
  "ForgeGenerateTopicCards",
  ForgeGenerateTopicCardsInputSchema,
  ForgeGenerateTopicCardsResultSchema,
  ForgeGenerateTopicCardsErrorSchema,
);

export const ForgeGenerateSelectedTopicCards = rpc(
  "ForgeGenerateSelectedTopicCards",
  ForgeGenerateSelectedTopicCardsInputSchema,
  ForgeGenerateSelectedTopicCardsResultSchema,
  ForgeGenerateSelectedTopicCardsErrorSchema,
);

export const ForgeGetDerivedCards = rpc(
  "ForgeGetDerivedCards",
  ForgeGetDerivedCardsInputSchema,
  ForgeGetDerivedCardsResultSchema,
  ForgeGetDerivedCardsErrorSchema,
);

export const ForgeGenerateDerivedCards = rpc(
  "ForgeGenerateDerivedCards",
  ForgeGenerateDerivedCardsInputSchema,
  ForgeGenerateDerivedCardsResultSchema,
  ForgeGenerateDerivedCardsErrorSchema,
);

export const ForgeGetCardCloze = rpc(
  "ForgeGetCardCloze",
  ForgeGetCardClozeInputSchema,
  ForgeGetCardClozeResultSchema,
  ForgeGetCardClozeErrorSchema,
);

export const ForgeGenerateCardCloze = rpc(
  "ForgeGenerateCardCloze",
  ForgeGenerateCardClozeInputSchema,
  ForgeGenerateCardClozeResultSchema,
  ForgeGenerateCardClozeErrorSchema,
);

export const ForgeReformulateCard = rpc(
  "ForgeReformulateCard",
  ForgeReformulateCardInputSchema,
  ForgeReformulateCardResultSchema,
  ForgeReformulateCardErrorSchema,
);

export const ForgeUpdateCard = rpc(
  "ForgeUpdateCard",
  ForgeUpdateCardInputSchema,
  ForgeUpdateCardResultSchema,
  ForgeUpdateCardErrorSchema,
);

export const ForgeUpdateDerivation = rpc(
  "ForgeUpdateDerivation",
  ForgeUpdateDerivationInputSchema,
  ForgeUpdateDerivationResultSchema,
  ForgeUpdateDerivationErrorSchema,
);

export const ForgeSaveTopicSelections = rpc(
  "ForgeSaveTopicSelections",
  ForgeSaveTopicSelectionsInputSchema,
  ForgeSaveTopicSelectionsResultSchema,
  ForgeSaveTopicSelectionsErrorSchema,
);

export const ForgeSetSessionDeckPath = rpc(
  "ForgeSetSessionDeckPath",
  ForgeSetSessionDeckPathInputSchema,
  ForgeSetSessionDeckPathResultSchema,
  ForgeSetSessionDeckPathErrorSchema,
);

export const ForgeListSessions = rpc(
  "ForgeListSessions",
  ForgeListSessionsInputSchema,
  ForgeListSessionsResultSchema,
  ForgeListSessionsErrorSchema,
);

export const ForgeAddCardToDeck = rpc(
  "ForgeAddCardToDeck",
  ForgeAddCardToDeckInputSchema,
  ForgeAddCardToDeckResultSchema,
  ForgeAddCardToDeckErrorSchema,
);

export const ForgeTopicChunkExtracted = event(
  "ForgeTopicChunkExtracted",
  ForgeTopicChunkExtractedEventSchema,
);

export const ForgeExtractionSessionCreated = event(
  "ForgeExtractionSessionCreated",
  ForgeExtractionSessionCreatedEventSchema,
);
