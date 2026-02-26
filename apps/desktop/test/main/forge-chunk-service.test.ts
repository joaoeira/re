import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { CHUNK_SIZE, makeChunkService } from "@main/forge/services/chunk-service";

describe("chunk service", () => {
  it("assigns page breaks at chunk boundaries to the next chunk", async () => {
    const chunkService = makeChunkService();
    const text = "a".repeat(CHUNK_SIZE + 100);

    const result = await Effect.runPromise(
      chunkService.chunkText({
        text,
        pageBreaks: [
          { offset: 0, page: 1 },
          { offset: CHUNK_SIZE, page: 2 },
        ],
      }),
    );

    expect(result.chunkCount).toBe(2);
    expect(result.chunks[0]?.pageBoundaries).toEqual([{ offset: 0, page: 1 }]);
    expect(result.chunks[1]?.pageBoundaries).toEqual([{ offset: 0, page: 2 }]);
  });

  it("adds a synthetic offset-0 boundary when a chunk starts mid-page", async () => {
    const chunkService = makeChunkService();
    const text = "a".repeat(CHUNK_SIZE + 10);

    const result = await Effect.runPromise(
      chunkService.chunkText({
        text,
        pageBreaks: [{ offset: 0, page: 1 }],
      }),
    );

    expect(result.chunkCount).toBe(2);
    expect(result.chunks[1]?.pageBoundaries[0]).toEqual({ offset: 0, page: 1 });
  });

  it("defaults synthetic boundaries to page 1 when page breaks are empty", async () => {
    const chunkService = makeChunkService();
    const text = "a".repeat(CHUNK_SIZE * 2 + 10);

    const result = await Effect.runPromise(
      chunkService.chunkText({
        text,
        pageBreaks: [],
      }),
    );

    expect(result.chunkCount).toBe(3);
    expect(result.chunks[0]?.pageBoundaries[0]).toEqual({ offset: 0, page: 1 });
    expect(result.chunks[1]?.pageBoundaries[0]).toEqual({ offset: 0, page: 1 });
    expect(result.chunks[2]?.pageBoundaries[0]).toEqual({ offset: 0, page: 1 });
  });
});
