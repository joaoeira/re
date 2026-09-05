import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { parseMetadata, serializeMetadata } from "../src/index.ts";

describe("parseMetadata", () => {
  it.effect(
    "imports a standalone record while preserving numeric spelling and normalizing dates",
    () =>
      Effect.gen(function* () {
        const comment =
          "<!--@ imported-card 5.20 4.30 2 1 2025-01-04T10:30:00+02:00 2025-01-09T10:30:00+02:00-->";

        for (const ending of ["", "\n", "\r\n"]) {
          const metadata = yield* parseMetadata(comment + ending);
          expect(serializeMetadata(metadata)).toBe(
            "<!--@ imported-card 5.20 4.30 2 1 2025-01-04T08:30:00.000Z 2025-01-09T08:30:00.000Z-->",
          );
        }
      }),
  );

  it.effect(
    "rejects incomplete records and additional content instead of extracting one record",
    () =>
      Effect.gen(function* () {
        const comment = "<!--@ imported-card 0 0 0 0-->";
        for (const input of [
          "",
          "imported-card 0 0 0 0",
          "<!--@ imported-card 0 0 0 0",
          `prefix ${comment}`,
          `${comment} trailing content`,
          `${comment}\nQuestion`,
          `${comment}\n${comment}`,
          `${comment}\n\n`,
          "<!--@ imported-card--><!-- 0 0 0 0-->",
        ]) {
          const error = yield* parseMetadata(input).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "InvalidMetadataFormat", line: 1 });
        }
      }),
  );

  it.effect("preserves recoverable metadata failures for a complete comment", () =>
    Effect.gen(function* () {
      const formatError = yield* parseMetadata("<!--@ imported-card 0 0-->").pipe(Effect.flip);
      expect(formatError).toMatchObject({ _tag: "InvalidMetadataFormat", line: 1 });

      const valueError = yield* parseMetadata("<!--@ imported-card 0 0 9 0-->").pipe(Effect.flip);
      expect(valueError).toMatchObject({ _tag: "InvalidFieldValue", line: 1 });
    }),
  );
});
