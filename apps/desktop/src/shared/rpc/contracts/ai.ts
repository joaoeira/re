import { rpc, streamRpc } from "electron-effect-rpc/contract";

import {
  AiGenerateTextErrorSchema,
  AiGenerateTextInputSchema,
  AiGenerateTextResultSchema,
  AiStreamChunkSchema,
  AiStreamErrorSchema,
  AiStreamTextInputSchema,
} from "@shared/rpc/schemas/ai";

export const AiStreamText = streamRpc(
  "AiStreamText",
  AiStreamTextInputSchema,
  AiStreamChunkSchema,
  AiStreamErrorSchema,
);

export const AiGenerateText = rpc(
  "AiGenerateText",
  AiGenerateTextInputSchema,
  AiGenerateTextResultSchema,
  AiGenerateTextErrorSchema,
);
