import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Data, Effect } from "effect";
import { PDFParse } from "pdf-parse";
import { toErrorMessage } from "@main/utils/format";

export class PdfFingerprintResolveError extends Data.TaggedError("PdfFingerprintResolveError")<{
  readonly sourceFilePath: string;
  readonly message: string;
}> {}

export class PdfTextExtractError extends Data.TaggedError("PdfTextExtractError")<{
  readonly sourceFilePath: string;
  readonly message: string;
}> {}

export interface PdfExtractor {
  readonly resolveFingerprint: (
    sourceFilePath: string,
  ) => Effect.Effect<string, PdfFingerprintResolveError>;
  readonly extractText: (sourceFilePath: string) => Effect.Effect<string, PdfTextExtractError>;
}

const withPdfParser = async <A>(
  sourceBytes: Uint8Array,
  execute: (parser: PDFParse) => Promise<A>,
): Promise<A> => {
  const parser = new PDFParse({ data: sourceBytes });

  try {
    return await execute(parser);
  } finally {
    try {
      await parser.destroy();
    } catch {
      // Best-effort resource cleanup.
    }
  }
};

const toSha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const firstNonEmptyFingerprint = (
  fingerprints: ReadonlyArray<string | null> | undefined,
): string | null => {
  if (!fingerprints) return null;

  for (const fingerprint of fingerprints) {
    if (typeof fingerprint === "string" && fingerprint.length > 0) {
      return fingerprint;
    }
  }

  return null;
};

export const makePdfExtractor = (): PdfExtractor => ({
  resolveFingerprint: (sourceFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const fileBuffer = await readFile(sourceFilePath);
        const sourceBytes = new Uint8Array(fileBuffer);
        const fallbackFingerprint = toSha256(sourceBytes);

        try {
          const info = await withPdfParser(sourceBytes, (parser) => parser.getInfo());
          return firstNonEmptyFingerprint(info.fingerprints) ?? fallbackFingerprint;
        } catch {
          return fallbackFingerprint;
        }
      },
      catch: (error) =>
        new PdfFingerprintResolveError({
          sourceFilePath,
          message: toErrorMessage(error),
        }),
    }),
  extractText: (sourceFilePath) =>
    Effect.tryPromise({
      try: async () => {
        const fileBuffer = await readFile(sourceFilePath);
        const sourceBytes = new Uint8Array(fileBuffer);
        const textResult = await withPdfParser(sourceBytes, (parser) => parser.getText());

        return textResult.text;
      },
      catch: (error) =>
        new PdfTextExtractError({
          sourceFilePath,
          message: toErrorMessage(error),
        }),
    }),
});

export const makeStubPdfExtractor = (): PdfExtractor => ({
  resolveFingerprint: (sourceFilePath) => Effect.succeed(`stub:${sourceFilePath}`),
  extractText: () => Effect.succeed(""),
});
