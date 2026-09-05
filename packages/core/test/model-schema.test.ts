import { describe, expect, it } from "@effect/vitest";
import { Effect, ParseResult, Schema } from "effect";
import {
  createMetadata,
  ItemMetadataSchema,
  ParsedFileSchema,
  parseFile,
  serializeFile,
} from "../src/index.ts";

describe("model schemas", () => {
  it.effect("validate and encode a parsed file without changing the stored deck", () =>
    Effect.gen(function* () {
      const markdown =
        "# Imported deck\n\n" +
        "<!--@ reviewed 5.20 4.30 2 1 2025-01-04T08:30:00.000Z 2025-01-09T08:30:00.000Z-->\n" +
        "<!--@ fresh 0 0 0 0-->\n" +
        "Shared content\r\n";
      const parsed = yield* parseFile(markdown);
      const validated = yield* Schema.decodeUnknown(ParsedFileSchema)(parsed);
      const encoded = yield* Schema.encode(ParsedFileSchema)(validated);

      expect(serializeFile(encoded)).toBe(markdown);
    }),
  );

  it.effect("report the location of an invalid card inside an imported file", () =>
    Effect.gen(function* () {
      const card = createMetadata();
      const error = yield* Schema.decodeUnknown(ParsedFileSchema)({
        preamble: "",
        items: [{ content: "Question", cards: [card, { ...card, state: 9 }] }],
      }).pipe(Effect.flip);

      expect(ParseResult.ArrayFormatter.formatErrorSync(error)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["items", 0, "cards", 1, "state"] }),
        ]),
      );
    }),
  );

  it.effect("require valid Date objects rather than decoding timestamps implicitly", () =>
    Effect.gen(function* () {
      for (const field of ["lastReview", "due"] as const) {
        for (const value of ["2025-01-04T08:30:00.000Z", new Date(NaN)]) {
          const error = yield* Schema.decodeUnknown(ItemMetadataSchema)({
            ...createMetadata(),
            [field]: value,
          }).pipe(Effect.flip);

          expect(ParseResult.ArrayFormatter.formatErrorSync(error)).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: [field] })]),
          );
        }
      }
    }),
  );
});
