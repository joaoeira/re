import { rpc } from "electron-effect-rpc/contract";

import {
  ForgeCreateSessionErrorSchema,
  ForgeCreateSessionInputSchema,
  ForgeCreateSessionResultSchema,
  ForgeExtractTextErrorSchema,
  ForgeExtractTextInputSchema,
  ForgeExtractTextResultSchema,
  ForgePreviewChunksErrorSchema,
  ForgePreviewChunksInputSchema,
  ForgePreviewChunksResultSchema,
  ForgeStartTopicExtractionErrorSchema,
  ForgeStartTopicExtractionInputSchema,
  ForgeStartTopicExtractionResultSchema,
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
