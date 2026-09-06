import { Effect, Schema } from "effect";

export interface ClozeSyntaxMatch {
  readonly raw: string;
  readonly index: number;
  readonly hidden: string;
  readonly hint: string | null;
  readonly start: number;
  readonly end: number;
}

export const ClozeSyntaxReasonSchema = Schema.Literal(
  "unclosed",
  "unbalanced_braces",
  "missing_index",
  "malformed_index",
  "missing_separator",
);

export type ClozeSyntaxReason = typeof ClozeSyntaxReasonSchema.Type;

export const ClozeSyntaxIssue = Schema.Struct({
  reason: ClozeSyntaxReasonSchema,
  start: Schema.Number,
  end: Schema.Number,
  fragment: Schema.String,
  message: Schema.String,
});

export type ClozeSyntaxIssue = typeof ClozeSyntaxIssue.Type;

export class ClozeSyntaxError extends Schema.TaggedError<ClozeSyntaxError>(
  "@re/core/ClozeSyntaxError",
)("ClozeSyntaxError", {
  issues: Schema.NonEmptyArray(ClozeSyntaxIssue),
}) {}

const CLOZE_DETECTION_PATTERN = /\{\{c\d+::/;
const CLOZE_OPENER = /\{\{c(\d+)::/g;

const isDigit = (char: string | undefined): boolean =>
  char !== undefined && char >= "0" && char <= "9";

const isIndexTokenChar = (char: string | undefined): boolean =>
  char !== undefined && char !== ":" && char !== "{" && char !== "}" && !/\s/.test(char);

type BalancedBodyResult =
  | { readonly kind: "ok"; readonly bodyEnd: number }
  | { readonly kind: "unclosed" }
  | { readonly kind: "unbalanced_braces"; readonly at: number };

const scanBalancedBody = (content: string, bodyStart: number): BalancedBodyResult => {
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
          return { kind: "ok", bodyEnd: i };
        }
        if (i + 1 >= content.length) {
          return { kind: "unclosed" };
        }
        return { kind: "unbalanced_braces", at: i };
      }
      depth -= 1;
    }
    i += 1;
  }

  return { kind: "unclosed" };
};

const clozeIssueMessage = (reason: ClozeSyntaxReason, start: number): string => {
  const at = `starting at character ${start}`;
  switch (reason) {
    case "unclosed":
      return `Unclosed cloze deletion ${at}`;
    case "unbalanced_braces":
      return `Cloze deletion has an unbalanced '}' ${at}`;
    case "missing_index":
      return `Cloze deletion is missing an index ${at}`;
    case "malformed_index":
      return `Cloze deletion has a malformed index ${at}`;
    case "missing_separator":
      return `Cloze deletion is missing '::' after the index ${at}`;
  }
};

const clozeIssue = (
  content: string,
  reason: ClozeSyntaxReason,
  start: number,
  end: number,
): ClozeSyntaxIssue => ({
  reason,
  start,
  end,
  fragment: content.slice(start, end),
  message: clozeIssueMessage(reason, start),
});

const scanClozeSyntax = (
  content: string,
): { readonly matches: ClozeSyntaxMatch[]; readonly issues: ClozeSyntaxIssue[] } => {
  const matches: ClozeSyntaxMatch[] = [];
  const issues: ClozeSyntaxIssue[] = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const start = content.indexOf("{{c", searchFrom);
    if (start === -1) {
      break;
    }

    let pos = start + 3;
    if (pos >= content.length) {
      break;
    }

    if (content[pos] === ":") {
      const end = content[pos + 1] === ":" ? pos + 2 : pos + 1;
      issues.push(clozeIssue(content, "missing_index", start, end));
      searchFrom = end;
      continue;
    }

    const tokenStart = pos;
    while (isIndexTokenChar(content[pos])) {
      pos += 1;
    }
    const token = content.slice(tokenStart, pos);
    const hadDigits = isDigit(token[0]);
    const isPureDigits = /^\d+$/.test(token);

    if (content[pos] === ":" && content[pos + 1] === ":") {
      if (isPureDigits) {
        const index = Number.parseInt(token, 10);
        const bodyStart = pos + 2;
        if (!Number.isFinite(index)) {
          searchFrom = bodyStart;
          continue;
        }

        const body = scanBalancedBody(content, bodyStart);
        if (body.kind === "ok") {
          const rawBody = content.slice(bodyStart, body.bodyEnd);
          const { hidden, hint } = splitClozeContent(rawBody);
          const end = body.bodyEnd + 2;
          matches.push({
            raw: content.slice(start, end),
            index,
            hidden,
            hint,
            start,
            end,
          });
          searchFrom = end;
          continue;
        }

        if (body.kind === "unclosed") {
          issues.push(clozeIssue(content, "unclosed", start, content.length));
        } else {
          issues.push(clozeIssue(content, "unbalanced_braces", start, body.at + 1));
        }
        searchFrom = bodyStart;
        continue;
      }

      if (token.length > 0) {
        issues.push(clozeIssue(content, "malformed_index", start, pos + 2));
        searchFrom = pos + 2;
        continue;
      }
    }

    if (hadDigits) {
      if (content[pos] === ":") {
        issues.push(clozeIssue(content, "missing_separator", start, pos + 1));
        searchFrom = pos + 1;
        continue;
      }
      issues.push(clozeIssue(content, "missing_separator", start, pos));
      searchFrom = Math.max(pos, start + 3);
      continue;
    }

    searchFrom = tokenStart;
  }

  return { matches, issues };
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

export const parseClozeDeletions = (content: string): readonly ClozeSyntaxMatch[] =>
  scanClozeSyntax(content).matches;

export const parseClozeDeletionsStrict = (
  content: string,
): Effect.Effect<readonly ClozeSyntaxMatch[], ClozeSyntaxError> => {
  const { matches, issues } = scanClozeSyntax(content);
  const [first, ...rest] = issues;
  if (first === undefined) {
    return Effect.succeed(matches);
  }
  return new ClozeSyntaxError({ issues: [first, ...rest] });
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

const maskClozeBodies = (content: string, deletions: readonly ClozeSyntaxMatch[]): string => {
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
