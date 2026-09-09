import { Data, Effect, Exit } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import {
  adaptItemType,
  ContentParseError,
  createMetadata,
  manualCardSpec,
  matchItemTypes,
  type EvaluableCardSpec,
  type ItemType,
  type Grade,
} from "../../src/core/index";

class GradeError extends Data.TaggedError("GradeError")<{}> {}

const type = (name: string, count: number): ItemType<string, Grade, GradeError> => ({
  name,
  parse: (content) =>
    content === "valid"
      ? Effect.succeed(content)
      : Effect.fail(new ContentParseError({ type: name, raw: content, message: "Invalid" })),
  cards: () =>
    Array.from({ length: count }, (_, index) => manualCardSpec("", "", name, String(index))),
});

const saved = (count: number, content = "valid") => ({
  content,
  cards: Array.from({ length: count }, () => createMetadata()),
});

describe("matchItemTypes", () => {
  it.effect(
    "uses metadata count and retains all matching interpretations in registration order",
    () =>
      Effect.gen(function* () {
        const matches = yield* matchItemTypes(
          [
            adaptItemType(type("wrong-count", 1)),
            adaptItemType(type("first", 2)),
            adaptItemType(type("second", 2)),
          ],
          saved(2),
        );
        expect(matches.map((match) => match.type.name)).toEqual(["first", "second"]);
        expect(matches[0].cards.map((card) => card.key)).toEqual(["0", "1"]);
        expectTypeOf(matches[0].cards).toEqualTypeOf<readonly EvaluableCardSpec<GradeError>[]>();
      }),
  );

  it.effect(
    "reports parseable types and their card counts so a mismatched item can be repaired",
    () =>
      Effect.gen(function* () {
        const result = yield* matchItemTypes(
          [adaptItemType(type("first", 2)), adaptItemType(type("second", 1))],
          saved(3),
        ).pipe(Effect.result);
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "ItemCardCountMismatch",
            metadataCount: 3,
            parseableTypes: [
              { name: "first", cardCount: 2 },
              { name: "second", cardCount: 1 },
            ],
          },
        });
      }),
  );

  it.effect("distinguishes unrecognized content from a metadata mismatch", () =>
    Effect.gen(function* () {
      const result = yield* matchItemTypes(
        [adaptItemType(type("first", 1))],
        saved(1, "invalid"),
      ).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "NoMatchingTypeError" } });
    }),
  );

  it.effect("does not hide a parser defect by falling back to another type", () =>
    Effect.gen(function* () {
      const defect = new Error("broken parser");
      const result = yield* matchItemTypes(
        [
          { name: "broken", parseCards: () => Effect.die(defect) },
          adaptItemType(type("fallback", 1)),
        ],
        saved(1),
      ).pipe(Effect.exit);
      expect(result).toEqual(Exit.die(defect));
    }),
  );
});
