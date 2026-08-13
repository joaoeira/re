import { Effect, Option, Schema } from "effect";
import {
  type CardSpec,
  type ContentParseDiagnostic,
  type Grade,
  type ItemType,
  ContentParseError,
  parseClozeDeletionsStrict,
  replaceClozeDeletionsWithContext,
  manualCardSpec,
  type ClozeSyntaxError,
  type ClozeSyntaxIssue,
  type ClozeSyntaxMatch,
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

const CLOZE = "cloze";

const toSortedDeletions = (matches: readonly ClozeSyntaxMatch[]): ClozeDeletion[] => {
  const deletions = matches.map(
    (deletion): ClozeDeletion => ({
      index: deletion.index,
      hidden: deletion.hidden,
      hint: deletion.hint ? Option.some(deletion.hint) : Option.none(),
      start: deletion.start,
      end: deletion.end,
    }),
  );

  return deletions.sort((a, b) => a.index - b.index);
};

const toDiagnostic = (issue: ClozeSyntaxIssue): ContentParseDiagnostic =>
  issue.end === undefined
    ? {
        reason: issue.reason,
        start: issue.start,
        fragment: issue.fragment,
        message: issue.message,
      }
    : {
        reason: issue.reason,
        start: issue.start,
        end: issue.end,
        fragment: issue.fragment,
        message: issue.message,
      };

const toContentParseError = (error: ClozeSyntaxError, raw: string): ContentParseError => {
  const primary = error.issues[0];
  const diagnostic = toDiagnostic(primary);
  return new ContentParseError({
    type: CLOZE,
    message: diagnostic.message,
    raw,
    reason: diagnostic.reason,
    start: diagnostic.start,
    ...(diagnostic.end === undefined ? {} : { end: diagnostic.end }),
    fragment: diagnostic.fragment,
    issues: error.issues.map(toDiagnostic),
  });
};

const escapeTexText = (text: string): string => text.replace(/([\\{}^_%#&~$])/g, "\\$1");

const generateReveal = (content: ClozeContent, targetIndex: number): string =>
  replaceClozeDeletionsWithContext(content.text, (deletion) => {
    if (deletion.index !== targetIndex) {
      return deletion.hidden;
    }
    return deletion.insideMath ? `\\boldsymbol{${deletion.hidden}}` : `**${deletion.hidden}**`;
  });

const generatePrompt = (content: ClozeContent, targetIndex: number): string =>
  replaceClozeDeletionsWithContext(content.text, (deletion) => {
    if (deletion.index !== targetIndex) {
      return deletion.hidden;
    }
    if (deletion.insideMath) {
      return deletion.hint ? `\\text{[${escapeTexText(deletion.hint)}]}` : `\\text{[\\ldots]}`;
    }
    return deletion.hint ? `**[${deletion.hint}]**` : "**[...]**";
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

  parse: (content: string) =>
    parseClozeDeletionsStrict(content).pipe(
      Effect.catchTag("ClozeSyntaxError", (error) =>
        Effect.fail(toContentParseError(error, content)),
      ),
      Effect.flatMap((matches) => {
        if (matches.length === 0) {
          return Effect.fail(
            new ContentParseError({
              type: CLOZE,
              message: "No cloze deletions found (expected {{c1::...}} syntax)",
              raw: content,
            }),
          );
        }

        return Effect.succeed({
          text: content,
          deletions: toSortedDeletions(matches),
        });
      }),
    ),

  cards: (content: ClozeContent): ReadonlyArray<CardSpec<Grade, never>> => {
    const indices: number[] = [];
    let lastIndex: number | null = null;
    for (const deletion of content.deletions) {
      if (deletion.index !== lastIndex) {
        indices.push(deletion.index);
        lastIndex = deletion.index;
      }
    }

    return indices.map((index) =>
      manualCardSpec(generatePrompt(content, index), generateReveal(content, index), CLOZE),
    );
  },
};
