import { Effect, Option } from "effect";
import { describe, it, assert } from "@effect/vitest";
import { ClozeType } from "../src/cloze";
import { ContentParseError } from "@re/core";

describe("ClozeType", () => {
  describe("parse", () => {
    it.scoped("parses single cloze deletion", () =>
      Effect.gen(function* () {
        const content = "The {{c1::capital}} of France is Paris.";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.text, content);
        assert.strictEqual(result.deletions.length, 1);
        assert.strictEqual(result.deletions[0]!.index, 1);
        assert.strictEqual(result.deletions[0]!.hidden, "capital");
      })
    );

    it.scoped("parses multiple cloze deletions", () =>
      Effect.gen(function* () {
        const content = "The {{c1::capital}} of {{c2::France}} is Paris.";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions.length, 2);
        assert.strictEqual(result.deletions[0]!.index, 1);
        assert.strictEqual(result.deletions[0]!.hidden, "capital");
        assert.strictEqual(result.deletions[1]!.index, 2);
        assert.strictEqual(result.deletions[1]!.hidden, "France");
      })
    );

    it.scoped("sorts deletions by index", () =>
      Effect.gen(function* () {
        const content = "{{c3::third}} {{c1::first}} {{c2::second}}";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions[0]!.index, 1);
        assert.strictEqual(result.deletions[0]!.hidden, "first");
        assert.strictEqual(result.deletions[1]!.index, 2);
        assert.strictEqual(result.deletions[1]!.hidden, "second");
        assert.strictEqual(result.deletions[2]!.index, 3);
        assert.strictEqual(result.deletions[2]!.hidden, "third");
      })
    );

    it.scoped("captures start and end positions", () =>
      Effect.gen(function* () {
        const content = "The {{c1::capital}} of France.";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions[0]!.start, 4);
        assert.strictEqual(result.deletions[0]!.end, 19);
      })
    );

    it.scoped("fails when no cloze deletions found", () =>
      Effect.gen(function* () {
        const content = "This is plain text without any cloze deletions.";
        const error = yield* ClozeType.parse(content).pipe(Effect.flip);

        assert.ok(error instanceof ContentParseError);
        assert.strictEqual(error.type, "cloze");
        assert.ok(error.message.includes("No cloze deletions"));
      })
    );

    it.scoped("allows duplicate cloze indices", () =>
      Effect.gen(function* () {
        const content = "{{c1::first}} and {{c1::second}}";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions.length, 2);
        assert.strictEqual(result.deletions[0]!.index, 1);
        assert.strictEqual(result.deletions[1]!.index, 1);
      })
    );

    it.scoped("handles empty hidden text", () =>
      Effect.gen(function* () {
        const content = "Fill in: {{c1::}}";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions[0]!.hidden, "");
      })
    );

    it.scoped("handles multi-line content", () =>
      Effect.gen(function* () {
        const content = `Line 1: {{c1::answer1}}
Line 2: {{c2::answer2}}`;
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions.length, 2);
      })
    );

    it.scoped("parses cloze deletion with hint", () =>
      Effect.gen(function* () {
        const content = "The {{c1::Paris::capital city}} is beautiful.";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions.length, 1);
        assert.strictEqual(result.deletions[0]!.index, 1);
        assert.strictEqual(result.deletions[0]!.hidden, "Paris");
        assert.ok(Option.isSome(result.deletions[0]!.hint));
        assert.strictEqual(Option.getOrNull(result.deletions[0]!.hint), "capital city");
      })
    );

    it.scoped("parses cloze without hint as Option.none", () =>
      Effect.gen(function* () {
        const content = "The {{c1::capital}} of France.";
        const result = yield* ClozeType.parse(content);

        assert.ok(Option.isNone(result.deletions[0]!.hint));
      })
    );

    it.scoped("treats empty hint as Option.none", () =>
      Effect.gen(function* () {
        const content = "The {{c1::Paris::}} is beautiful.";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions[0]!.hidden, "Paris");
        assert.ok(Option.isNone(result.deletions[0]!.hint));
      })
    );

    it.scoped("parses mixed clozes with and without hints", () =>
      Effect.gen(function* () {
        const content = "{{c1::Paris::capital}} of {{c2::France}}";
        const result = yield* ClozeType.parse(content);

        assert.strictEqual(result.deletions.length, 2);
        assert.ok(Option.isSome(result.deletions[0]!.hint));
        assert.strictEqual(Option.getOrNull(result.deletions[0]!.hint), "capital");
        assert.ok(Option.isNone(result.deletions[1]!.hint));
      })
    );
  });

  describe("cards", () => {
    it.effect("returns one card per deletion", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "{{c1::a}} and {{c2::b}} and {{c3::c}}"
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(cards.length, 3);
      })
    );

    it.effect("card order matches cloze index order", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "{{c3::third}} {{c1::first}} {{c2::second}}"
        );
        const cards = ClozeType.cards(content);

        // Cards should be ordered by index (c1, c2, c3)
        assert.ok(cards[0]!.prompt.includes("[...]")); // c1 hidden
        assert.ok(cards[0]!.prompt.includes("second")); // c2 visible
        assert.ok(cards[0]!.prompt.includes("third")); // c3 visible
      })
    );

    it.effect("duplicate indices share a single card", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "{{c1::first}} and {{c1::second}}"
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(cards.length, 1);
        assert.strictEqual(cards[0]!.prompt, "[...] and [...]");
        assert.strictEqual(cards[0]!.reveal, "**first** and **second**");
      })
    );

    it.effect("prompt hides target and shows others", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "The {{c1::capital}} of {{c2::France}} is Paris."
        );
        const cards = ClozeType.cards(content);

        // Card 0 (c1): capital hidden, France visible
        assert.strictEqual(
          cards[0]!.prompt,
          "The [...] of France is Paris."
        );

        // Card 1 (c2): capital visible, France hidden
        assert.strictEqual(
          cards[1]!.prompt,
          "The capital of [...] is Paris."
        );
      })
    );

    it.effect("reveal bolds the target cloze for each card", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "The {{c1::capital}} of {{c2::France}} is Paris."
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(
          cards[0]!.reveal,
          "The **capital** of France is Paris."
        );
        assert.strictEqual(
          cards[1]!.reveal,
          "The capital of **France** is Paris."
        );
      })
    );

    it.effect("card grade function returns response unchanged", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse("{{c1::test}}");
        const cards = ClozeType.cards(content);
        const card = cards[0]!;

        const grade2 = yield* card.grade(2);
        assert.strictEqual(grade2, 2);
      })
    );

    it.effect("single deletion card", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "The answer is {{c1::42}}."
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(cards.length, 1);
        assert.strictEqual(cards[0]!.prompt, "The answer is [...].");
        assert.strictEqual(cards[0]!.reveal, "The answer is **42**.");
      })
    );

    it.effect("prompt shows hint instead of [...] when provided", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "The {{c1::Paris::capital city}} is beautiful."
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(cards.length, 1);
        assert.strictEqual(cards[0]!.prompt, "The [capital city] is beautiful.");
        assert.strictEqual(cards[0]!.reveal, "The **Paris** is beautiful.");
      })
    );

    it.effect("mixed hints and no hints in same content", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "{{c1::Paris::capital}} of {{c2::France}}"
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(cards.length, 2);
        // Card 0 (c1): shows [capital] for Paris, France visible
        assert.strictEqual(cards[0]!.prompt, "[capital] of France");
        // Card 1 (c2): Paris visible, shows [...] for France
        assert.strictEqual(cards[1]!.prompt, "Paris of [...]");
      })
    );

    it.effect("reveal strips hints and bolds target cloze", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "The {{c1::capital::hint1}} of {{c2::France::hint2}} is Paris."
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(cards[0]!.reveal, "The **capital** of France is Paris.");
        assert.strictEqual(cards[1]!.reveal, "The capital of **France** is Paris.");
      })
    );

    it.effect("duplicate indices with hints share a single card", () =>
      Effect.gen(function* () {
        const content = yield* ClozeType.parse(
          "{{c1::first::hint1}} and {{c1::second::hint2}}"
        );
        const cards = ClozeType.cards(content);

        assert.strictEqual(cards.length, 1);
        assert.strictEqual(cards[0]!.prompt, "[hint1] and [hint2]");
        assert.strictEqual(cards[0]!.reveal, "**first** and **second**");
      })
    );
  });
});
