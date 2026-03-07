export interface ClozeSyntaxMatch {
  readonly raw: string;
  readonly index: number;
  readonly hidden: string;
  readonly hint: string | null;
  readonly start: number;
  readonly end: number;
}

const CLOZE_DETECTION_PATTERN = /\{\{c\d+::/;
const CLOZE_OPENER = /\{\{c(\d+)::/g;

const scanBalancedBody = (content: string, bodyStart: number): number | null => {
  let depth = 0;
  let i = bodyStart;

  while (i < content.length) {
    if (content[i] === "\\" && i + 1 < content.length) {
      i += 2;
      continue;
    }
    if (content[i] === "{") {
      depth += 1;
    } else if (content[i] === "}") {
      if (depth === 0) {
        if (i + 1 < content.length && content[i + 1] === "}") {
          return i;
        }
        return null;
      }
      depth -= 1;
    }
    i += 1;
  }

  return null;
};

const splitClozeContent = (rawContent: string): { hidden: string; hint: string | null } => {
  let depth = 0;
  for (let i = 0; i < rawContent.length; i++) {
    if (rawContent[i] === "\\" && i + 1 < rawContent.length) {
      i += 1;
      continue;
    }
    if (rawContent[i] === "{") {
      depth += 1;
    } else if (rawContent[i] === "}") {
      depth -= 1;
    } else if (
      depth === 0 &&
      rawContent[i] === ":" &&
      i + 1 < rawContent.length &&
      rawContent[i + 1] === ":"
    ) {
      const hidden = rawContent.slice(0, i);
      const rest = rawContent.slice(i + 2);
      const nextSep = rest.indexOf("::");
      const hint = nextSep === -1 ? rest : rest.slice(0, nextSep);
      return { hidden, hint: hint.length > 0 ? hint : null };
    }
  }

  return { hidden: rawContent, hint: null };
};

export const hasClozeDeletion = (content: string): boolean => CLOZE_DETECTION_PATTERN.test(content);

export const parseClozeDeletions = (content: string): readonly ClozeSyntaxMatch[] => {
  const matches: ClozeSyntaxMatch[] = [];
  const opener = new RegExp(CLOZE_OPENER.source, "g");
  let match: RegExpExecArray | null = null;

  while ((match = opener.exec(content)) !== null) {
    const index = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(index)) {
      continue;
    }

    const bodyStart = match.index + match[0].length;
    const bodyEnd = scanBalancedBody(content, bodyStart);
    if (bodyEnd === null) {
      continue;
    }

    const rawBody = content.slice(bodyStart, bodyEnd);
    const { hidden, hint } = splitClozeContent(rawBody);
    const end = bodyEnd + 2;

    matches.push({
      raw: content.slice(match.index, end),
      index,
      hidden,
      hint,
      start: match.index,
      end,
    });

    opener.lastIndex = end;
  }

  return matches;
};

export const nextClozeDeletionIndex = (content: string): number => {
  const opener = new RegExp(CLOZE_OPENER.source, "g");
  let maxIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = opener.exec(content)) !== null) {
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

interface MathSpan {
  readonly start: number;
  readonly end: number;
}

const maskClozeBodies = (
  content: string,
  deletions: readonly ClozeSyntaxMatch[],
): string => {
  if (deletions.length === 0) return content;

  let result = "";
  let cursor = 0;

  for (const deletion of deletions) {
    result += content.slice(cursor, deletion.start);
    result += "X".repeat(deletion.end - deletion.start);
    cursor = deletion.end;
  }

  result += content.slice(cursor);
  return result;
};

const skipCodeSpan = (content: string, start: number): number => {
  let ticks = 0;
  let i = start;
  while (i < content.length && content[i] === "`") {
    ticks += 1;
    i += 1;
  }

  const closer = "`".repeat(ticks);
  const closeIdx = content.indexOf(closer, i);
  return closeIdx === -1 ? i : closeIdx + ticks;
};

const isFlankingOpen = (content: string, afterDollar: number): boolean => {
  if (afterDollar >= content.length) return false;
  return !/\s/.test(content[afterDollar]!);
};

const isFlankingClose = (content: string, beforeDollar: number): boolean => {
  if (beforeDollar < 0) return false;
  return !/\s/.test(content[beforeDollar]!);
};

const parseMathSpans = (
  content: string,
  deletions: readonly ClozeSyntaxMatch[],
): readonly MathSpan[] => {
  const masked = maskClozeBodies(content, deletions);
  const spans: MathSpan[] = [];
  let i = 0;

  while (i < masked.length) {
    if (masked[i] === "\\" && i + 1 < masked.length) {
      i += 2;
      continue;
    }

    if (masked[i] === "`") {
      i = skipCodeSpan(masked, i);
      continue;
    }

    if (masked[i] === "$") {
      if (masked[i + 1] === "$") {
        const searchStart = i + 2;
        const closeIdx = masked.indexOf("$$", searchStart);
        if (closeIdx !== -1) {
          spans.push({ start: i, end: closeIdx + 2 });
          i = closeIdx + 2;
        } else {
          i += 2;
        }
        continue;
      }

      const afterOpen = i + 1;
      if (!isFlankingOpen(masked, afterOpen)) {
        i += 1;
        continue;
      }

      let j = afterOpen;
      let found = false;
      while (j < masked.length) {
        if (masked[j] === "\n") break;
        if (masked[j] === "\\" && j + 1 < masked.length) {
          j += 2;
          continue;
        }
        if (masked[j] === "$" && isFlankingClose(masked, j - 1)) {
          spans.push({ start: i, end: j + 1 });
          i = j + 1;
          found = true;
          break;
        }
        j += 1;
      }
      if (!found) {
        i += 1;
      }
      continue;
    }

    i += 1;
  }

  return spans;
};

const isInsideMath = (spans: readonly MathSpan[], position: number): boolean =>
  spans.some((span) => position > span.start && position < span.end);

export type ClozeReplacerContext = ClozeSyntaxMatch & { readonly insideMath: boolean };

export const replaceClozeDeletionsWithContext = (
  content: string,
  replacer: (deletion: ClozeReplacerContext) => string,
): string => {
  const deletions = parseClozeDeletions(content);
  if (deletions.length === 0) {
    return content;
  }

  const mathSpans = parseMathSpans(content, deletions);
  let cursor = 0;
  let output = "";

  for (const deletion of deletions) {
    output += content.slice(cursor, deletion.start);
    output += replacer({ ...deletion, insideMath: isInsideMath(mathSpans, deletion.start) });
    cursor = deletion.end;
  }

  output += content.slice(cursor);
  return output;
};
