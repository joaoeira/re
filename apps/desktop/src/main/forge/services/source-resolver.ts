import { createHash } from "node:crypto";
import path from "node:path";

import { Data, Effect } from "effect";

import type {
  ForgeChunkPageBoundary,
  ForgePdfSourceInput,
  ForgeSourceInput,
  ForgeSourceKind,
  ForgeTextSourceInput,
} from "@shared/rpc/schemas/forge";
import type { PdfExtractor } from "./pdf-extractor";

export class ForgeSourceResolverError extends Data.TaggedError("ForgeSourceResolverError")<{
  readonly sourceKind: ForgeSourceKind;
  readonly sourceLabel: string;
  readonly message: string;
}> {}

export class ForgeSourceResolverEmptyTextError extends Data.TaggedError(
  "ForgeSourceResolverEmptyTextError",
)<{
  readonly sourceKind: ForgeSourceKind;
  readonly sourceLabel: string;
  readonly message: string;
}> {}

export type ResolvedForgeSourceMetadata = {
  readonly sourceKind: ForgeSourceKind;
  readonly sourceLabel: string;
  readonly sourceFilePath: string | null;
  readonly sourceFingerprint: string;
};

export type ResolvedForgeSourceContent = ResolvedForgeSourceMetadata & {
  readonly text: string;
  readonly pageBreaks: ReadonlyArray<ForgeChunkPageBoundary>;
  readonly totalPages: number;
};

export interface ForgeSourceResolver {
  readonly resolveMetadata: (
    source: ForgeSourceInput,
  ) => Effect.Effect<
    ResolvedForgeSourceMetadata,
    ForgeSourceResolverError | ForgeSourceResolverEmptyTextError
  >;
  readonly resolveContent: (
    source: ForgeSourceInput,
  ) => Effect.Effect<
    ResolvedForgeSourceContent,
    ForgeSourceResolverError | ForgeSourceResolverEmptyTextError
  >;
}

const TEXT_SOURCE_FALLBACK_LABEL = "Pasted text";
const TEXT_SOURCE_LABEL_MAX_CHARS = 80;

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, "\n");

const truncate = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}…`;

const toSha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const derivePdfSourceLabel = (sourceFilePath: string): string =>
  path.basename(sourceFilePath) || sourceFilePath;

const deriveTextSourceLabel = (source: ForgeTextSourceInput, normalizedText: string): string => {
  const explicitLabel = source.sourceLabel?.trim();
  if (explicitLabel && explicitLabel.length > 0) {
    return explicitLabel;
  }

  const firstNonEmptyLine = normalizeLineEndings(source.text)
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .find((line) => line.length > 0);

  if (firstNonEmptyLine) {
    return truncate(firstNonEmptyLine, TEXT_SOURCE_LABEL_MAX_CHARS);
  }

  const collapsedText = collapseWhitespace(normalizedText);
  return collapsedText.length > 0
    ? truncate(collapsedText, TEXT_SOURCE_LABEL_MAX_CHARS)
    : TEXT_SOURCE_FALLBACK_LABEL;
};

const normalizeTextSource = (
  source: ForgeTextSourceInput,
): Effect.Effect<
  {
    readonly sourceLabel: string;
    readonly normalizedText: string;
    readonly sourceFingerprint: string;
  },
  ForgeSourceResolverEmptyTextError
> =>
  Effect.gen(function* () {
    const normalizedText = normalizeLineEndings(source.text).trim();
    const sourceLabel = deriveTextSourceLabel(source, normalizedText);

    if (normalizedText.length === 0) {
      return yield* Effect.fail(
        new ForgeSourceResolverEmptyTextError({
          sourceKind: "text",
          sourceLabel,
          message: "No extractable text found in text source.",
        }),
      );
    }

    return {
      sourceLabel,
      normalizedText,
      sourceFingerprint: toSha256(normalizedText),
    };
  });

const ensureAbsolutePdfPath = (
  source: ForgePdfSourceInput,
): Effect.Effect<string, ForgeSourceResolverError> =>
  path.isAbsolute(source.sourceFilePath)
    ? Effect.succeed(source.sourceFilePath)
    : Effect.fail(
        new ForgeSourceResolverError({
          sourceKind: "pdf",
          sourceLabel: derivePdfSourceLabel(source.sourceFilePath),
          message: `Forge sourceFilePath must be absolute: ${source.sourceFilePath}`,
        }),
      );

export const makeForgeSourceResolver = ({
  pdfExtractor,
}: {
  readonly pdfExtractor: PdfExtractor;
}): ForgeSourceResolver => ({
  resolveMetadata: (source) =>
    Effect.gen(function* () {
      if (source.kind === "text") {
        const normalized = yield* normalizeTextSource(source);
        return {
          sourceKind: "text",
          sourceLabel: normalized.sourceLabel,
          sourceFilePath: null,
          sourceFingerprint: normalized.sourceFingerprint,
        } satisfies ResolvedForgeSourceMetadata;
      }

      const sourceFilePath = yield* ensureAbsolutePdfPath(source);
      const sourceLabel = derivePdfSourceLabel(sourceFilePath);
      const sourceFingerprint = yield* pdfExtractor.resolveFingerprint(sourceFilePath).pipe(
        Effect.mapError(
          (error) =>
            new ForgeSourceResolverError({
              sourceKind: "pdf",
              sourceLabel,
              message: error.message,
            }),
        ),
      );

      return {
        sourceKind: "pdf",
        sourceLabel,
        sourceFilePath,
        sourceFingerprint,
      } satisfies ResolvedForgeSourceMetadata;
    }),
  resolveContent: (source) =>
    Effect.gen(function* () {
      if (source.kind === "text") {
        const normalized = yield* normalizeTextSource(source);
        return {
          sourceKind: "text",
          sourceLabel: normalized.sourceLabel,
          sourceFilePath: null,
          sourceFingerprint: normalized.sourceFingerprint,
          text: normalized.normalizedText,
          pageBreaks: [{ offset: 0, page: 1 }],
          totalPages: 1,
        } satisfies ResolvedForgeSourceContent;
      }

      const sourceFilePath = yield* ensureAbsolutePdfPath(source);
      const sourceLabel = derivePdfSourceLabel(sourceFilePath);
      const extracted = yield* pdfExtractor.extractText(sourceFilePath).pipe(
        Effect.mapError(
          (error) =>
            new ForgeSourceResolverError({
              sourceKind: "pdf",
              sourceLabel,
              message: error.message,
            }),
        ),
      );

      if (extracted.text.trim().length === 0) {
        return yield* Effect.fail(
          new ForgeSourceResolverEmptyTextError({
            sourceKind: "pdf",
            sourceLabel,
            message: `No extractable text found in PDF source: ${sourceFilePath}`,
          }),
        );
      }

      return {
        sourceKind: "pdf",
        sourceLabel,
        sourceFilePath,
        sourceFingerprint: extracted.sourceFingerprint,
        text: extracted.text,
        pageBreaks: extracted.pageBreaks,
        totalPages: extracted.totalPages,
      } satisfies ResolvedForgeSourceContent;
    }),
});
