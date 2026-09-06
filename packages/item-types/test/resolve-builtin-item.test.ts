import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { createMetadata } from "@simbyotic/re-core";
import { annotateBuiltinCardKeys, resolveBuiltinCard, resolveBuiltinItem } from "../src";

describe("resolveBuiltinItem", () => {
  it.effect("prefers cloze when both interpretations fit the saved metadata", () =>
    Effect.gen(function* () {
      const match = yield* resolveBuiltinItem({
        content: "The capital of {{c1::France}}?\n---\nParis",
        cards: [createMetadata()],
      });
      expect(match.type.name).toBe("cloze");
      expect(match.cards[0]!.key).toBe("c1");
      expect(match.cards[0]!.prompt).toContain("**[...]**");
    }),
  );

  it.effect("uses card count before the cloze preference", () =>
    Effect.gen(function* () {
      const content = "{{c1::Paris}} is in {{c2::France}}.\n---\nAnswer";
      const oneCard = yield* resolveBuiltinItem({ content, cards: [createMetadata()] });
      const twoCards = yield* resolveBuiltinItem({
        content,
        cards: [createMetadata(), createMetadata()],
      });
      expect(oneCard.type.name).toBe("qa");
      expect(twoCards.type.name).toBe("cloze");
    }),
  );
});

describe("builtin card identity", () => {
  it.effect("resolves a captured key only while it belongs to the requested ID", () =>
    Effect.gen(function* () {
      const first = createMetadata();
      const second = createMetadata();
      const item = {
        content: "{{c1::Paris}} is in {{c3::France}}.",
        cards: [first, second],
      };
      const cardKey = "c3";

      const mismatch = yield* resolveBuiltinCard(item, { cardId: first.id, cardKey }).pipe(
        Effect.either,
      );
      expect(mismatch).toMatchObject({
        _tag: "Left",
        left: { _tag: "BuiltinCardNotFound", cardId: first.id, cardKey: "c3" },
      });

      const resolved = yield* resolveBuiltinCard(item, { cardId: second.id, cardKey });
      expect(resolved.card.id).toBe(second.id);
      expect(resolved.spec).toMatchObject({
        key: "c3",
        reveal: expect.stringContaining("**France**"),
      });
    }),
  );
});

describe("annotateBuiltinCardKeys", () => {
  it.effect("preserves interleaved queue order and entry fields", () =>
    Effect.gen(function* () {
      const cloze = {
        content: "{{c1::one}} {{c3::three}} {{c5::five}}",
        cards: [createMetadata(), createMetadata(), createMetadata()],
      };
      const qa = { content: "Question\n---\nAnswer", cards: [createMetadata()] };

      const { items: entries } = yield* annotateBuiltinCardKeys([
        { item: cloze, card: cloze.cards[1]!, label: "second" },
        { item: qa, card: qa.cards[0]!, label: "qa" },
        { item: cloze, card: cloze.cards[0]!, label: "first" },
        { item: cloze, card: cloze.cards[2]!, label: "third" },
      ]);

      expect(entries.map(({ label, cardKey }) => ({ label, cardKey }))).toEqual([
        { label: "second", cardKey: "c3" },
        { label: "qa", cardKey: "main" },
        { label: "first", cardKey: "c1" },
        { label: "third", cardKey: "c5" },
      ]);
    }),
  );

  it.effect(
    "excludes invalid entries and reports each invalid item once alongside healthy cards",
    () =>
      Effect.gen(function* () {
        const malformed = { content: "No card syntax", cards: [createMetadata()] };
        const mismatched = {
          content: "{{c1::one}}",
          cards: [createMetadata(), createMetadata()],
        };
        const healthy = { content: "Question\n---\nAnswer", cards: [createMetadata()] };
        const { items, errors } = yield* annotateBuiltinCardKeys([
          { item: malformed, card: malformed.cards[0]!, label: "malformed" },
          { item: mismatched, card: mismatched.cards[0]!, label: "mismatched" },
          { item: mismatched, card: mismatched.cards[1]!, label: "same mismatched item" },
          { item: healthy, card: createMetadata(), label: "missing" },
          { item: healthy, card: healthy.cards[0]!, label: "healthy" },
        ]);
        expect(items.map(({ label, cardKey }) => ({ label, cardKey }))).toEqual([
          { label: "healthy", cardKey: "main" },
        ]);
        expect(errors).toMatchObject([
          { entry: { label: "malformed" }, error: { _tag: "NoMatchingTypeError" } },
          { entry: { label: "mismatched" }, error: { _tag: "ItemCardCountMismatch" } },
          { entry: { label: "missing" }, error: { _tag: "BuiltinCardNotFound" } },
        ]);
      }),
  );
});
