import { Effect } from "effect";
import type {
  ItemId,
  ItemMetadata,
  NumericField,
  ParsedFile,
  State,
} from "../types.ts";
import {
  InvalidFieldValue,
  InvalidMetadataFormat,
  type MetadataParseError,
} from "../errors.ts";

const METADATA_PREFIX = "<!--@ ";
const METADATA_SUFFIX = "-->";
const METADATA_MIN_LENGTH =
  METADATA_PREFIX.length + METADATA_SUFFIX.length + 1;
const CARRIAGE_RETURN = 13;

// Keep validation rules in sync with schema/* modules.
const NUMERIC_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;
const STATE_PATTERN = /^[0-3]$/;
const LEARNING_STEPS_PATTERN = /^(0|[1-9]\d*)$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

type FieldParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

type MetadataParseResult =
  | { ok: true; value: ItemMetadata }
  | { ok: false; error: MetadataParseError };

type MutableItem = {
  cards: ItemMetadata[];
  content: string;
};

const tokenizeMetadata = (input: string): string[] => {
  const tokens: string[] = [];
  let start = -1;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code <= 32) {
      if (start !== -1) {
        tokens.push(input.slice(start, i));
        start = -1;
      }
    } else if (start === -1) {
      start = i;
    }
  }

  if (start !== -1) {
    tokens.push(input.slice(start));
  }

  return tokens;
};

const parseNumericField = (raw: string): FieldParseResult<NumericField> => {
  if (!NUMERIC_PATTERN.test(raw)) {
    return { ok: false, message: `Invalid numeric format: "${raw}"` };
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, message: `Numeric value out of range: "${raw}"` };
  }
  return { ok: true, value: { value, raw } };
};

const parseState = (raw: string): FieldParseResult<State> => {
  if (!STATE_PATTERN.test(raw)) {
    return { ok: false, message: `State must be 0-3, got "${raw}"` };
  }
  return { ok: true, value: parseInt(raw, 10) as State };
};

const parseLearningSteps = (raw: string): FieldParseResult<number> => {
  if (!LEARNING_STEPS_PATTERN.test(raw)) {
    return {
      ok: false,
      message: `LearningSteps must be non-negative integer, got "${raw}"`,
    };
  }
  return { ok: true, value: parseInt(raw, 10) };
};

const isValidCalendarDate = (match: RegExpExecArray, d: Date): boolean => {
  const [, year, month, day, hour, minute, second, , tz] = match;

  if (tz === "Z") {
    return (
      d.getUTCFullYear() === parseInt(year!, 10) &&
      d.getUTCMonth() + 1 === parseInt(month!, 10) &&
      d.getUTCDate() === parseInt(day!, 10) &&
      d.getUTCHours() === parseInt(hour!, 10) &&
      d.getUTCMinutes() === parseInt(minute!, 10) &&
      d.getUTCSeconds() === parseInt(second!, 10)
    );
  }

  const reparsed = new Date(match.input);
  return d.getTime() === reparsed.getTime();
};

const parseLastReview = (raw: string): FieldParseResult<Date> => {
  const match = ISO_TIMESTAMP_PATTERN.exec(raw);
  if (!match) {
    return {
      ok: false,
      message: `Timestamp must include timezone (Z or +/-HH:MM): "${raw}"`,
    };
  }

  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return { ok: false, message: `Invalid ISO timestamp: "${raw}"` };
  }
  if (!isValidCalendarDate(match, d)) {
    return {
      ok: false,
      message: `Invalid calendar date (normalization detected): "${raw}"`,
    };
  }
  return { ok: true, value: d };
};

const parseMetadataLine = (
  inner: string,
  lineNumber: number
): MetadataParseResult => {
  const tokens = tokenizeMetadata(inner);

  if (tokens.length < 5 || tokens.length > 6) {
    return {
      ok: false,
      error: new InvalidMetadataFormat({
        line: lineNumber,
        raw: inner,
        reason: `Expected 5-6 fields, got ${tokens.length}`,
      }),
    };
  }

  const [
    idRaw,
    stabilityRaw,
    difficultyRaw,
    stateRaw,
    stepsRaw,
    lastReviewRaw,
  ] = tokens;

  const invalidField = (expected: string): MetadataParseResult => ({
    ok: false,
    error: new InvalidFieldValue({
      line: lineNumber,
      field: "metadata",
      value: inner,
      expected,
    }),
  });

  if (!idRaw || idRaw.length === 0) {
    return invalidField("ItemId must be non-empty");
  }

  const stability = parseNumericField(stabilityRaw!);
  if (!stability.ok) {
    return invalidField(stability.message);
  }

  const difficulty = parseNumericField(difficultyRaw!);
  if (!difficulty.ok) {
    return invalidField(difficulty.message);
  }

  const state = parseState(stateRaw!);
  if (!state.ok) {
    return invalidField(state.message);
  }

  const learningSteps = parseLearningSteps(stepsRaw!);
  if (!learningSteps.ok) {
    return invalidField(learningSteps.message);
  }

  let lastReview: Date | null = null;
  if (lastReviewRaw !== undefined) {
    const parsedLastReview = parseLastReview(lastReviewRaw);
    if (!parsedLastReview.ok) {
      return invalidField(parsedLastReview.message);
    }
    lastReview = parsedLastReview.value;
  }

  return {
    ok: true,
    value: {
      id: idRaw as ItemId,
      stability: stability.value,
      difficulty: difficulty.value,
      state: state.value,
      learningSteps: learningSteps.value,
      lastReview,
    },
  };
};

const extractMetadataInner = (
  content: string,
  lineStart: number,
  lineEnd: number
): string | null => {
  let end = lineEnd;
  if (end - lineStart < METADATA_MIN_LENGTH) {
    return null;
  }

  if (content.charCodeAt(end - 1) === CARRIAGE_RETURN) {
    end--;
    if (end - lineStart < METADATA_MIN_LENGTH) {
      return null;
    }
  }

  if (!content.startsWith(METADATA_PREFIX, lineStart)) {
    return null;
  }

  if (
    content.charCodeAt(end - 3) !== 45 ||
    content.charCodeAt(end - 2) !== 45 ||
    content.charCodeAt(end - 1) !== 62
  ) {
    return null;
  }

  return content.slice(
    lineStart + METADATA_PREFIX.length,
    end - METADATA_SUFFIX.length
  );
};

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
): Effect.Effect<ParsedFile, MetadataParseError> =>
  Effect.suspend(() => {
    const items: MutableItem[] = [];
    let preambleEnd = content.length;
    let mode: "preamble" | "metadata" | "content" = "preamble";
    let contentStartOffset = 0;
    let lineStart = 0;
    let lineNumber = 1;
    let error: MetadataParseError | null = null;

    while (lineStart <= content.length) {
      const rawLineEnd = content.indexOf("\n", lineStart);
      const hasNewline = rawLineEnd !== -1;
      const lineEnd = hasNewline ? rawLineEnd : content.length;

      const inner = extractMetadataInner(content, lineStart, lineEnd);
      if (inner !== null) {
        const parsed = parseMetadataLine(inner, lineNumber);
        if (!parsed.ok) {
          error = parsed.error;
          break;
        }

        if (mode === "preamble") {
          preambleEnd = lineStart;
        } else if (mode === "content") {
          const lastItem = items[items.length - 1];
          if (lastItem) {
            lastItem.content =
              contentStartOffset <= content.length
                ? content.slice(contentStartOffset, lineStart)
                : "";
          }
        }

        if (mode !== "metadata") {
          items.push({ cards: [], content: "" });
        }

        items[items.length - 1]!.cards.push(parsed.value);
        contentStartOffset = lineEnd + (hasNewline ? 1 : 0);
        mode = "metadata";
      } else if (mode === "metadata") {
        mode = "content";
      }

      if (!hasNewline) {
        break;
      }

      lineStart = lineEnd + 1;
      lineNumber++;
    }

    if (error) {
      return Effect.fail(error);
    }

    if (items.length > 0) {
      const lastItem = items[items.length - 1]!;
      lastItem.content =
        contentStartOffset <= content.length
          ? content.slice(contentStartOffset)
          : "";
    }

    const preamble =
      preambleEnd === content.length
        ? content
        : content.slice(0, preambleEnd);

    return Effect.succeed({
      preamble,
      items,
    });
  });
