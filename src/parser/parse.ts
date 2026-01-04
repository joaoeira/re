import { Effect, Schema } from "effect";
import type { Item, ItemMetadata, ParsedFile } from "../types.ts";
import {
  InvalidFieldValue,
  InvalidMetadataFormat,
  type MetadataParseError,
} from "../errors.ts";
import {
  ItemIdSchema,
  NumericFieldFromString,
  StateFromString,
  LearningStepsFromString,
  LastReviewFromString,
} from "../schema/index.ts";
import { METADATA_LINE_PATTERN } from "./patterns.ts";

const parseMetadataLine = (
  inner: string,
  lineNumber: number
): Effect.Effect<ItemMetadata, MetadataParseError> => {
  const tokens = inner.trim().split(/\s+/);

  if (tokens.length < 5 || tokens.length > 6) {
    return Effect.fail(
      new InvalidMetadataFormat({
        line: lineNumber,
        raw: inner,
        reason: `Expected 5-6 fields, got ${tokens.length}`,
      })
    );
  }

  const [
    idRaw,
    stabilityRaw,
    difficultyRaw,
    stateRaw,
    stepsRaw,
    lastReviewRaw,
  ] = tokens;

  return Effect.all({
    id: Schema.decodeUnknown(ItemIdSchema)(idRaw!),
    stability: Schema.decodeUnknown(NumericFieldFromString)(stabilityRaw!),
    difficulty: Schema.decodeUnknown(NumericFieldFromString)(difficultyRaw!),
    state: Schema.decodeUnknown(StateFromString)(stateRaw!),
    learningSteps: Schema.decodeUnknown(LearningStepsFromString)(stepsRaw!),
    lastReview: lastReviewRaw
      ? Schema.decodeUnknown(LastReviewFromString)(lastReviewRaw)
      : Effect.succeed(null),
  }).pipe(
    Effect.mapError((parseError) => {
      // Extract field info from the error if possible
      const message = String(parseError);
      return new InvalidFieldValue({
        line: lineNumber,
        field: "metadata",
        value: inner,
        expected: message,
      });
    })
  );
};

interface LineInfo {
  readonly lineNumber: number; // 1-based
  readonly content: string;
  readonly startOffset: number; // byte offset where this line starts (after previous \n)
  readonly endOffset: number; // byte offset at end of line (before \n or at EOF)
}

/**
 * Parse a markdown file containing spaced repetition items.
 *
 * Returns a ParsedFile with:
 * - preamble: content before first <!--@ line (byte-perfect)
 * - items: array of Item, each with metadata and content (content is byte-perfect)
 *
 * Metadata lines are canonicalized on serialization (single spaces, LF endings, UTC timestamps).
 */
export const parseFile = (
  content: string
): Effect.Effect<ParsedFile, MetadataParseError> => {
  // Split into lines, preserving info about offsets
  const lines: LineInfo[] = [];
  let offset = 0;
  const rawLines = content.split("\n");

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    lines.push({
      lineNumber: i + 1,
      content: line,
      startOffset: offset,
      endOffset: offset + line.length,
    });
    // +1 for the \n we split on (except for last line if no trailing newline)
    offset += line.length + 1;
  }

  // Find all metadata lines
  const metadataLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (METADATA_LINE_PATTERN.test(lines[i]!.content)) {
      metadataLineIndices.push(i);
    }
  }

  // If no metadata lines, entire file is preamble
  if (metadataLineIndices.length === 0) {
    return Effect.succeed({
      preamble: content,
      items: [],
    });
  }

  // Extract preamble (content before first metadata line)
  const firstMetaIdx = metadataLineIndices[0]!;
  const firstMetaLine = lines[firstMetaIdx]!;
  const preamble = content.slice(0, firstMetaLine.startOffset);

  const itemEffects: Effect.Effect<Item, MetadataParseError>[] = [];

  for (let i = 0; i < metadataLineIndices.length; i++) {
    const metaLineIdx = metadataLineIndices[i]!;
    const metaLine = lines[metaLineIdx]!;
    const match = METADATA_LINE_PATTERN.exec(metaLine.content);

    if (!match) continue;

    const inner = match[1]!;

    // Content starts after the metadata line's newline
    const contentStartOffset = metaLine.endOffset + 1;

    // Content ends at the start of the next metadata line, or EOF
    const nextMetaLineIdx = metadataLineIndices[i + 1];
    const contentEndOffset =
      nextMetaLineIdx !== undefined
        ? lines[nextMetaLineIdx]!.startOffset
        : content.length;

    // Extract content, handling edge case where content might be empty
    // or where file ends without trailing newline
    const itemContent =
      contentStartOffset <= content.length
        ? content.slice(contentStartOffset, contentEndOffset)
        : "";

    const itemEffect = parseMetadataLine(inner, metaLine.lineNumber).pipe(
      Effect.map(
        (metadata): Item => ({
          metadata,
          content: itemContent,
        })
      )
    );

    itemEffects.push(itemEffect);
  }

  return Effect.all(itemEffects).pipe(
    Effect.map((items) => ({
      preamble,
      items,
    }))
  );
};
