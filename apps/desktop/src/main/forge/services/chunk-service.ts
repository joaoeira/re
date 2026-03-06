import { Effect } from "effect";

import { FORGE_CHUNK_SIZE, type ForgeChunkPageBoundary } from "@shared/rpc/schemas/forge";

export const CHUNK_SIZE = FORGE_CHUNK_SIZE;

type ChunkedTextInput = {
  readonly text: string;
  readonly pageBreaks: ReadonlyArray<ForgeChunkPageBoundary>;
};

export type ChunkedText = {
  readonly text: string;
  readonly sequenceOrder: number;
  readonly pageBoundaries: ReadonlyArray<ForgeChunkPageBoundary>;
};

export type ChunkTextResult = {
  readonly chunks: ReadonlyArray<ChunkedText>;
  readonly chunkCount: number;
};

export interface ChunkService {
  readonly chunkText: (input: ChunkedTextInput) => Effect.Effect<ChunkTextResult, never>;
}

const normalizePageBreaks = (
  pageBreaks: ReadonlyArray<ForgeChunkPageBoundary>,
  textLength: number,
): ReadonlyArray<ForgeChunkPageBoundary> => {
  const filtered = pageBreaks.filter(
    (pageBreak) => pageBreak.offset >= 0 && pageBreak.offset < textLength,
  );

  return filtered.slice().sort((a, b) => {
    if (a.offset === b.offset) {
      return a.page - b.page;
    }
    return a.offset - b.offset;
  });
};

const pageAtOffset = (
  pageBreaks: ReadonlyArray<ForgeChunkPageBoundary>,
  startOffset: number,
): number => {
  let page = 1;
  for (const pageBreak of pageBreaks) {
    if (pageBreak.offset > startOffset) {
      break;
    }

    page = pageBreak.page;
  }

  return page;
};

const chunkTextImpl = ({ text, pageBreaks }: ChunkedTextInput): ChunkTextResult => {
  if (text.length === 0) {
    return {
      chunks: [],
      chunkCount: 0,
    };
  }

  const normalizedBreaks = normalizePageBreaks(pageBreaks, text.length);
  const chunkCount = Math.ceil(text.length / CHUNK_SIZE);
  const chunks: ChunkedText[] = [];

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const pageBoundaries = normalizedBreaks
      .filter((pageBreak) => Math.floor(pageBreak.offset / CHUNK_SIZE) === chunkIndex)
      .map((pageBreak) => ({
        offset: pageBreak.offset - start,
        page: pageBreak.page,
      }))
      .sort((a, b) => a.offset - b.offset);

    const chunkStartPage = pageAtOffset(normalizedBreaks, start);
    const hasBoundaryAtZero = pageBoundaries.some((boundary) => boundary.offset === 0);

    if (!hasBoundaryAtZero) {
      pageBoundaries.unshift({
        offset: 0,
        page: chunkStartPage,
      });
    }

    chunks.push({
      text: text.slice(start, end),
      sequenceOrder: chunkIndex,
      pageBoundaries,
    });
  }

  return {
    chunks,
    chunkCount,
  };
};

export const makeChunkService = (): ChunkService => ({
  chunkText: (input) => Effect.sync(() => chunkTextImpl(input)),
});
