import { Effect, Option, Schema } from "effect";
import {
  type CardSpec,
  type Grade,
  type ItemType,
  ContentParseError,
  manualCardSpec,
} from "@re/core";

export const ClozeDeletion = Schema.Struct({
  index: Schema.Number,
  hidden: Schema.String,
  hint: Schema.optionalWith(Schema.String, { as: "Option" }),
  start: Schema.Number,
  end: Schema.Number,
});

export type ClozeDeletion = typeof ClozeDeletion.Type;

export const ClozeContent = Schema.Struct({
  text: Schema.String,
  deletions: Schema.Array(ClozeDeletion),
});

export type ClozeContent = typeof ClozeContent.Type;

// Matches {{c1::hidden}} or {{c1::hidden::hint}}
const CLOZE_PATTERN = /\{\{c(\d+)::([^}]*)\}\}/g;
const CLOZE = "cloze";

const parseDeletions = (text: string): ClozeDeletion[] => {
  const deletions: ClozeDeletion[] = [];
  let match: RegExpExecArray | null;

  while ((match = CLOZE_PATTERN.exec(text)) !== null) {
    const content = match[2]!;
    // Split by :: to separate hidden text from optional hint
    const parts = content.split("::");
    const hidden = parts[0]!;
    // Treat empty hints as no hint (Option.none)
    const hintText = parts[1];
    const hint = hintText ? Option.some(hintText) : Option.none();

    deletions.push({
      index: parseInt(match[1]!, 10),
      hidden,
      hint,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return deletions.sort((a, b) => a.index - b.index);
};

const getCleanText = (text: string): string =>
  text.replace(CLOZE_PATTERN, (_, __, content: string) => {
    // Extract just the hidden part, not the hint
    const parts = content.split("::");
    return parts[0]!;
  });

const generatePrompt = (content: ClozeContent, targetIndex: number): string =>
  content.text.replace(CLOZE_PATTERN, (_, indexStr, rawContent: string) => {
    const index = parseInt(indexStr, 10);
    const parts = rawContent.split("::");
    const hidden = parts[0]!;
    const hint = parts[1];

    if (index === targetIndex) {
      return hint ? `[${hint}]` : "[...]";
    }
    return hidden;
  });

/**
 * Canonical syntax: `The {{c1::capital}} of {{c2::France}} is Paris.`
 * With optional hint: `The {{c1::Paris::capital city}} of France.`
 *
 * One card per unique index. Duplicate indices share a card.
 * When a hint is provided, it displays as [hint] instead of [...].
 */
export const ClozeType: ItemType<ClozeContent, Grade, never> = {
  name: "cloze",

  parse: (content: string) => {
    const deletions = parseDeletions(content);

    if (deletions.length === 0) {
      return Effect.fail(
        new ContentParseError({
          type: CLOZE,
          message: "No cloze deletions found (expected {{c1::...}} syntax)",
          raw: content,
        })
      );
    }

    return Effect.succeed({
      text: content,
      deletions,
    });
  },

  cards: (content: ClozeContent): ReadonlyArray<CardSpec<Grade, never>> => {
    const reveal = getCleanText(content.text);

    const indices: number[] = [];
    let lastIndex: number | null = null;
    for (const deletion of content.deletions) {
      if (deletion.index !== lastIndex) {
        indices.push(deletion.index);
        lastIndex = deletion.index;
      }
    }

    return indices.map((index) =>
      manualCardSpec(generatePrompt(content, index), reveal)
    );
  },
};
