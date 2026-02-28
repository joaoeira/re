import { event, rpc } from "electron-effect-rpc/contract";

import {
  ForgeCreateSessionErrorSchema,
  ForgeCreateSessionInputSchema,
  ForgeCreateSessionResultSchema,
  ForgeListSessionsErrorSchema,
  ForgeListSessionsInputSchema,
  ForgeListSessionsResultSchema,
  ForgeGenerateCardClozeErrorSchema,
  ForgeGenerateCardClozeInputSchema,
  ForgeGenerateCardClozeResultSchema,
  ForgeGenerateCardPermutationsErrorSchema,
  ForgeGenerateCardPermutationsInputSchema,
  ForgeGenerateCardPermutationsResultSchema,
  ForgeGenerateTopicCardsErrorSchema,
  ForgeGenerateTopicCardsInputSchema,
  ForgeGenerateTopicCardsResultSchema,
  ForgeGetCardClozeErrorSchema,
  ForgeGetCardClozeInputSchema,
  ForgeGetCardClozeResultSchema,
  ForgeGetCardPermutationsErrorSchema,
  ForgeGetCardPermutationsInputSchema,
  ForgeGetCardPermutationsResultSchema,
  ForgeGetCardsSnapshotErrorSchema,
  ForgeGetCardsSnapshotInputSchema,
  ForgeGetCardsSnapshotResultSchema,
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
  ForgeUpdateCardErrorSchema,
  ForgeUpdateCardInputSchema,
  ForgeUpdateCardResultSchema,
  ForgeUpdatePermutationErrorSchema,
  ForgeUpdatePermutationInputSchema,
  ForgeUpdatePermutationResultSchema,
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

export const ForgeGetCardPermutations = rpc(
  "ForgeGetCardPermutations",
  ForgeGetCardPermutationsInputSchema,
  ForgeGetCardPermutationsResultSchema,
  ForgeGetCardPermutationsErrorSchema,
);

export const ForgeGenerateCardPermutations = rpc(
  "ForgeGenerateCardPermutations",
  ForgeGenerateCardPermutationsInputSchema,
  ForgeGenerateCardPermutationsResultSchema,
  ForgeGenerateCardPermutationsErrorSchema,
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

export const ForgeUpdateCard = rpc(
  "ForgeUpdateCard",
  ForgeUpdateCardInputSchema,
  ForgeUpdateCardResultSchema,
  ForgeUpdateCardErrorSchema,
);

export const ForgeUpdatePermutation = rpc(
  "ForgeUpdatePermutation",
  ForgeUpdatePermutationInputSchema,
  ForgeUpdatePermutationResultSchema,
  ForgeUpdatePermutationErrorSchema,
);

export const ForgeListSessions = rpc(
  "ForgeListSessions",
  ForgeListSessionsInputSchema,
  ForgeListSessionsResultSchema,
  ForgeListSessionsErrorSchema,
);

export const ForgeTopicChunkExtracted = event(
  "ForgeTopicChunkExtracted",
  ForgeTopicChunkExtractedEventSchema,
);
