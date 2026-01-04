import type { ItemMetadata, ParsedFile } from "../types.ts";

/**
 * Serialize ItemMetadata to a metadata line string.
 * Uses the preserved `raw` string for numeric fields to maintain precision.
 * Timestamps are canonicalized to UTC via toISOString().
 */
export const serializeMetadata = (m: ItemMetadata): string => {
  const parts = [
    m.id,
    m.stability.raw,
    m.difficulty.raw,
    m.state.toString(),
    m.learningSteps.toString(),
  ];

  if (m.lastReview !== null) {
    parts.push(m.lastReview.toISOString());
  }

  return `<!--@ ${parts.join(" ")}-->`;
};

/**
 * Serialize a ParsedFile back to a string.
 *
 * Round-trip guarantees:
 * - Preamble and content between metadata lines: byte-perfect
 * - Metadata lines: canonicalized (single spaces, LF endings, UTC timestamps)
 */
export const serializeFile = (file: ParsedFile): string => {
  let result = file.preamble;

  for (const item of file.items) {
    result += serializeMetadata(item.metadata);
    result += "\n";
    result += item.content;
  }

  return result;
};
