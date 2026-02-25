export interface ClozeSyntaxMatch {
  readonly raw: string;
  readonly index: number;
  readonly hidden: string;
  readonly hint: string | null;
  readonly start: number;
  readonly end: number;
}

const CLOZE_DETECTION_PATTERN = /\{\{c\d+::/;
const CLOZE_MATCH_PATTERN_SOURCE = "\\{\\{c(\\d+)::([^}]*)\\}\\}";
const CLOZE_INDEX_PATTERN_SOURCE = "\\{\\{c(\\d+)::";
const HINT_SEPARATOR = "::";

const splitClozeContent = (rawContent: string): { hidden: string; hint: string | null } => {
  const parts = rawContent.split(HINT_SEPARATOR);
  const hidden = parts[0]!;
  const hint = parts[1];

  return {
    hidden,
    hint: hint && hint.length > 0 ? hint : null,
  };
};

export const hasClozeDeletion = (content: string): boolean => CLOZE_DETECTION_PATTERN.test(content);

export const parseClozeDeletions = (content: string): readonly ClozeSyntaxMatch[] => {
  const matches: ClozeSyntaxMatch[] = [];
  const parserPattern = new RegExp(CLOZE_MATCH_PATTERN_SOURCE, "g");
  let match: RegExpExecArray | null = null;

  while ((match = parserPattern.exec(content)) !== null) {
    const index = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(index)) {
      continue;
    }

    const { hidden, hint } = splitClozeContent(match[2]!);

    matches.push({
      raw: match[0],
      index,
      hidden,
      hint,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return matches;
};

export const nextClozeDeletionIndex = (content: string): number => {
  const indexPattern = new RegExp(CLOZE_INDEX_PATTERN_SOURCE, "g");
  let maxIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = indexPattern.exec(content)) !== null) {
    const index = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(index)) {
      continue;
    }

    maxIndex = Math.max(maxIndex, index);
  }

  return maxIndex + 1;
};

export const replaceClozeDeletions = (
  content: string,
  replacer: (deletion: ClozeSyntaxMatch) => string,
): string => {
  const deletions = parseClozeDeletions(content);
  if (deletions.length === 0) {
    return content;
  }

  let cursor = 0;
  let output = "";

  for (const deletion of deletions) {
    output += content.slice(cursor, deletion.start);
    output += replacer(deletion);
    cursor = deletion.end;
  }

  output += content.slice(cursor);
  return output;
};
