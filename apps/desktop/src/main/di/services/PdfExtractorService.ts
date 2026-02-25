import { Context, Layer } from "effect";

import type { PdfExtractor } from "@main/forge/services/pdf-extractor";

export const PdfExtractorService = Context.GenericTag<PdfExtractor>(
  "@re/desktop/main/PdfExtractorService",
);

export const PdfExtractorServiceLive = (pdfExtractor: PdfExtractor) =>
  Layer.succeed(PdfExtractorService, pdfExtractor);
