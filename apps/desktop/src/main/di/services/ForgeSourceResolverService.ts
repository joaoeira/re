import { Context, Effect, Layer } from "effect";

import {
  makeForgeSourceResolver,
  type ForgeSourceResolver,
} from "@main/forge/services/source-resolver";

import { PdfExtractorService } from "./PdfExtractorService";

export const ForgeSourceResolverService = Context.GenericTag<ForgeSourceResolver>(
  "@re/desktop/main/ForgeSourceResolverService",
);
export type ForgeSourceResolverService = ForgeSourceResolver;

export const ForgeSourceResolverServiceLive = Layer.effect(
  ForgeSourceResolverService,
  Effect.gen(function* () {
    const pdfExtractor = yield* PdfExtractorService;
    return makeForgeSourceResolver({ pdfExtractor });
  }),
);
