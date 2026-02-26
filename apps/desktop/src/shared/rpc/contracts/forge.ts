import { rpc } from "electron-effect-rpc/contract";

import {
  ForgeCreateSessionErrorSchema,
  ForgeCreateSessionInputSchema,
  ForgeCreateSessionResultSchema,
  ForgeExtractTextErrorSchema,
  ForgeExtractTextInputSchema,
  ForgeExtractTextResultSchema,
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
