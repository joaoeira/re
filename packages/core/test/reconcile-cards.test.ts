import { Either, Effect, Option } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  adaptItemType,
  createMetadataWithId,
  manualCardSpec,
  numericField,
  reconcileCards,
  type ItemId,
} from "../src/index";

const metadata = (id: string) => createMetadataWithId(id as ItemId);

describe("reconcileCards", () => {
  it("keeps surviving cards' learning data in the new key order and marks new cards", () => {
    const reviewed = {
      ...metadata("third"),
      stability: { value: 7, raw: "7.00" },
      difficulty: numericField(3),
      state: 2 as const,
      learningSteps: 1,
      lastReview: new Date("2026-01-01T12:00:00Z"),
      due: new Date("2026-01-08T12:00:00Z"),
    };
    const result = Either.getOrThrow(
      reconcileCards(
        { keys: ["c1", "c2", "c3"], cards: [metadata("first"), metadata("removed"), reviewed] },
        ["c3", "c1", "c4"],
      ),
    );

    expect(Option.getOrThrow(result[0]!)).toMatchObject({
      id: "third",
      stability: { value: 7, raw: "7.00" },
      difficulty: { value: 3 },
      state: 2,
      learningSteps: 1,
      lastReview: reviewed.lastReview,
      due: reviewed.due,
    });
    expect(Option.getOrThrow(result[1]!).id).toBe("first");
    expect(Option.isNone(result[2]!)).toBe(true);
  });

  it.effect("rejects a custom type whose generated keys are ambiguous", () =>
    Effect.gen(function* () {
      const type = adaptItemType({
        name: "broken-bidirectional",
        parse: Effect.succeed,
        cards: () => [
          manualCardSpec("Forward", "Answer", "vocabulary", "same"),
          manualCardSpec("Reverse", "Answer", "vocabulary", "same"),
        ],
      });
      const keys = (yield* type.parseCards("content")).map((card) => card.key);
      for (const [oldKeys, nextKeys] of [
        [keys, ["new"]],
        [["old"], keys],
      ]) {
        const result = reconcileCards(
          { keys: oldKeys!, cards: oldKeys!.map((key, index) => metadata(`${key}-${index}`)) },
          nextKeys!,
        );
        expect(result).toMatchObject({
          _tag: "Left",
          left: { _tag: "DuplicateCardKey", key: "same" },
        });
      }
    }),
  );

  it("refuses to guess which metadata belongs to a key when counts differ", () => {
    expect(
      reconcileCards({ keys: ["c1", "c3"], cards: [metadata("unknown")] }, ["c3"]),
    ).toMatchObject({
      _tag: "Left",
      left: { _tag: "ReconcileCardCountMismatch", keyCount: 2, metadataCount: 1 },
    });
  });
});
