import { Effect, Schema } from "effect";
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
  start: Schema.Number,
  end: Schema.Number,
});

export type ClozeDeletion = typeof ClozeDeletion.Type;

export const ClozeContent = Schema.Struct({
  text: Schema.String,
  deletions: Schema.Array(ClozeDeletion),
});

export type ClozeContent = typeof ClozeContent.Type;

const CLOZE_PATTERN = /\{\{c(\d+)::([^}]*)\}\}/g;
const CLOZE = "cloze";

const parseDeletions = (text: string): ClozeDeletion[] => {
  const deletions: ClozeDeletion[] = [];
  let match: RegExpExecArray | null;

  while ((match = CLOZE_PATTERN.exec(text)) !== null) {
    deletions.push({
      index: parseInt(match[1]!, 10),
      hidden: match[2]!,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return deletions.sort((a, b) => a.index - b.index);
};

const getCleanText = (text: string): string =>
  text.replace(CLOZE_PATTERN, (_, __, hidden) => hidden);

const generatePrompt = (content: ClozeContent, targetIndex: number): string =>
  content.text.replace(CLOZE_PATTERN, (_, indexStr, hidden) => {
    const index = parseInt(indexStr, 10);
    return index === targetIndex ? "[...]" : hidden;
  });

/**
 * Canonical syntax: `The {{c1::capital}} of {{c2::France}} is Paris.`
 *
 * One card per unique index. Duplicate indices share a card.
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
