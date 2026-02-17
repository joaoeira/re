import { Effect } from "effect";
import { describe, it, assert } from "@effect/vitest";
import { QAType } from "../src/qa";
import { ContentParseError } from "@re/core";

describe("QAType", () => {
  describe("parse", () => {
    it.scoped("parses valid Q&A content", () =>
      Effect.gen(function* () {
        const content = `What is the capital of France?
---
Paris`;
        const result = yield* QAType.parse(content);

        assert.strictEqual(result.question, "What is the capital of France?");
        assert.strictEqual(result.answer, "Paris");
      }),
    );

    it.scoped("trims whitespace from question and answer", () =>
      Effect.gen(function* () {
        const content = `  What is 2+2?
---
  4  `;
        const result = yield* QAType.parse(content);

        assert.strictEqual(result.question, "What is 2+2?");
        assert.strictEqual(result.answer, "4");
      }),
    );

    it.scoped("handles multi-line question and answer", () =>
      Effect.gen(function* () {
        const content = `What are the primary colors?
List all three.
---
Red
Yellow
Blue`;
        const result = yield* QAType.parse(content);

        assert.strictEqual(result.question, "What are the primary colors?\nList all three.");
        assert.strictEqual(result.answer, "Red\nYellow\nBlue");
      }),
    );

    it.scoped("fails when separator is missing", () =>
      Effect.gen(function* () {
        const content = `What is the capital of France?
Paris`;
        const error = yield* QAType.parse(content).pipe(Effect.flip);

        assert.ok(error instanceof ContentParseError);
        assert.strictEqual(error.type, "qa");
        assert.ok(error.message.includes("separator"));
      }),
    );

    it.scoped("fails when question is empty", () =>
      Effect.gen(function* () {
        const content = `
---
Paris`;
        const error = yield* QAType.parse(content).pipe(Effect.flip);

        assert.ok(error instanceof ContentParseError);
        assert.strictEqual(error.type, "qa");
        assert.ok(error.message.includes("Question"));
      }),
    );

    it.scoped("fails when answer is empty", () =>
      Effect.gen(function* () {
        const content = `What is the capital of France?
---
`;
        const error = yield* QAType.parse(content).pipe(Effect.flip);

        assert.ok(error instanceof ContentParseError);
        assert.strictEqual(error.type, "qa");
        assert.ok(error.message.includes("Answer"));
      }),
    );

    it.scoped("handles separator with surrounding content", () =>
      Effect.gen(function* () {
        // Only the first --- should act as separator
        const content = `What does --- mean?
---
It's a horizontal rule`;
        const result = yield* QAType.parse(content);

        assert.strictEqual(result.question, "What does --- mean?");
        assert.strictEqual(result.answer, "It's a horizontal rule");
      }),
    );
  });

  describe("cards", () => {
    it.effect("returns a single card", () =>
      Effect.gen(function* () {
        const content = yield* QAType.parse("Question?\n---\nAnswer");
        const cards = QAType.cards(content);

        assert.strictEqual(cards.length, 1);
      }),
    );

    it.effect("card has correct prompt and reveal", () =>
      Effect.gen(function* () {
        const content = yield* QAType.parse("What is 2+2?\n---\n4");
        const cards = QAType.cards(content);

        assert.strictEqual(cards[0]!.prompt, "What is 2+2?");
        assert.strictEqual(cards[0]!.reveal, "4");
      }),
    );

    it.effect("card grade function returns response unchanged", () =>
      Effect.gen(function* () {
        const content = yield* QAType.parse("Q\n---\nA");
        const cards = QAType.cards(content);
        const card = cards[0]!;

        const grade0 = yield* card.grade(0);
        const grade1 = yield* card.grade(1);
        const grade2 = yield* card.grade(2);
        const grade3 = yield* card.grade(3);

        assert.strictEqual(grade0, 0);
        assert.strictEqual(grade1, 1);
        assert.strictEqual(grade2, 2);
        assert.strictEqual(grade3, 3);
      }),
    );
  });
});
