import { Effect } from "effect";
import { describe, it, assert } from "@effect/vitest";
import { inferType, NoMatchingTypeError } from "@re/core";
import { QAType } from "../src/qa";
import { ClozeType } from "../src/cloze";

describe("inferType", () => {
  const types = [ClozeType, QAType];

  it.scoped("matches cloze content first", () =>
    Effect.gen(function* () {
      const content = "The {{c1::capital}} of France is Paris.";
      const result = yield* inferType(types, content);

      assert.strictEqual(result.type.name, "cloze");
    })
  );

  it.scoped("falls through to QA when cloze doesn't match", () =>
    Effect.gen(function* () {
      const content = "What is 2+2?\n---\n4";
      const result = yield* inferType(types, content);

      assert.strictEqual(result.type.name, "qa");
    })
  );

  it.scoped("returns parsed content", () =>
    Effect.gen(function* () {
      const content = "Question?\n---\nAnswer";
      const result = yield* inferType(types, content);

      assert.deepStrictEqual(result.content, {
        question: "Question?",
        answer: "Answer",
      });
    })
  );

  it.scoped("fails when no type matches", () =>
    Effect.gen(function* () {
      const content = "Just plain text without any markers";
      const error = yield* inferType(types, content).pipe(Effect.flip);

      assert.ok(error instanceof NoMatchingTypeError);
      assert.deepStrictEqual(error.triedTypes, ["cloze", "qa"]);
    })
  );

  it.scoped("respects type order (first match wins)", () =>
    Effect.gen(function* () {
      // Content that matches both cloze AND has ---
      // But since cloze is first, it should match cloze
      const content = "{{c1::test}}\n---\nsome answer";
      const result = yield* inferType(types, content);

      assert.strictEqual(result.type.name, "cloze");
    })
  );

  it.scoped("works with reversed order", () =>
    Effect.gen(function* () {
      const reversedTypes = [QAType, ClozeType];
      // This matches both, but QA is first now
      const content = "{{c1::test}}\n---\nsome answer";
      const result = yield* inferType(reversedTypes, content);

      assert.strictEqual(result.type.name, "qa");
    })
  );

  it.scoped("cards can be derived from inferred result", () =>
    Effect.gen(function* () {
      const content = "Q?\n---\nA";
      const result = yield* inferType(types, content);
      const cards = result.type.cards(result.content);

      assert.strictEqual(cards.length, 1);
      assert.strictEqual(cards[0]!.prompt, "Q?");
      assert.strictEqual(cards[0]!.reveal, "A");
    })
  );
});
