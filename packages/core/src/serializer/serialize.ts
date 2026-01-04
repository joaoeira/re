import type { ItemMetadata, ParsedFile } from "../types.ts";

/**
 * Serialize ItemMetadata to a metadata line string.
 * Uses the preserved `raw` string for numeric fields to maintain precision.
 * Timestamps are canonicalized to UTC via toISOString().
 */
export const serializeMetadata = (m: ItemMetadata): string => {
  const lastReview = m.lastReview ? ` ${m.lastReview.toISOString()}` : "";
  return (
    `<!--@ ${m.id} ${m.stability.raw} ${m.difficulty.raw} ${m.state} ` +
    `${m.learningSteps}${lastReview}-->`
  );
};

/**
 * Serialize a ParsedFile back to a string.
 *
 * Round-trip guarantees:
 * - Preamble and content between metadata lines: byte-perfect
 * - Metadata lines: canonicalized (single spaces, LF endings, UTC timestamps)
 */
export const serializeFile = (file: ParsedFile): string => {
  const parts: string[] = [file.preamble];

  for (const item of file.items) {
    for (const card of item.cards) {
      parts.push(serializeMetadata(card), "\n");
    }
    parts.push(item.content);
  }

  return parts.join("");
};
