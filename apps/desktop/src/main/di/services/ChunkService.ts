import { Context, Layer } from "effect";

import type { ChunkService as ForgeChunkService } from "@main/forge/services/chunk-service";

export const ChunkService = Context.GenericTag<ForgeChunkService>("@re/desktop/main/ChunkService");

export const ChunkServiceLive = (chunkService: ForgeChunkService) =>
  Layer.succeed(ChunkService, chunkService);
