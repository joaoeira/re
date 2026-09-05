import type { ItemMetadata, ParsedFile } from "../types.js";

/**
 * Serialize ItemMetadata to a metadata line string.
 * Uses the preserved `raw` string for numeric fields to maintain precision.
 * Timestamps are canonicalized to UTC via toISOString().
 * Both timestamps must be present or both null; an incomplete pair throws RangeError.
 */
export const serializeMetadata = (m: ItemMetadata): string => {
  if ((m.lastReview === null) !== (m.due === null)) {
    throw new RangeError("Metadata requires both lastReview and due, or neither timestamp");
  }

  const parts = [
    m.id,
    m.stability.raw,
    m.difficulty.raw,
    m.state.toString(),
    m.learningSteps.toString(),
  ];

  if (m.lastReview !== null && m.due !== null) {
    parts.push(m.lastReview.toISOString(), m.due.toISOString());
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
    for (const card of item.cards) {
      result += serializeMetadata(card);
      result += "\n";
    }
    result += item.content;
  }

  return result;
};
