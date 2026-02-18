import { Effect } from "effect";
import { describe, it, assert } from "@effect/vitest";
import { parseFile } from "../src/parser/index.ts";

describe("parseFile", () => {
  it.scoped("parses a simple file with one item", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 0 0 0 0-->
What is the capital of France?
---
Paris
`;
      const result = yield* parseFile(content);

      assert.strictEqual(result.preamble, "");
      assert.strictEqual(result.items.length, 1);

      const item = result.items[0]!;
      assert.strictEqual(item.cards.length, 1);
      assert.strictEqual(item.cards[0]!.id, "abc123");
      assert.strictEqual(item.cards[0]!.stability.value, 0);
      assert.strictEqual(item.cards[0]!.difficulty.value, 0);
      assert.strictEqual(item.cards[0]!.state, 0);
      assert.strictEqual(item.cards[0]!.learningSteps, 0);
      assert.strictEqual(item.cards[0]!.lastReview, null);
      assert.strictEqual(item.cards[0]!.due, null);
      assert.strictEqual(
        item.content,
        `What is the capital of France?
---
Paris
`,
      );
    }),
  );

  it.scoped("parses a file with preamble", () =>
    Effect.gen(function* () {
      const content = `---
title: My Flashcards
---

<!--@ abc123 0 0 0 0-->
What is 2+2?
---
4
`;
      const result = yield* parseFile(content);

      assert.strictEqual(
        result.preamble,
        `---
title: My Flashcards
---

`,
      );
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]!.cards[0]!.id, "abc123");
    }),
  );

  it.scoped("parses a file with multiple items", () =>
    Effect.gen(function* () {
      const content = `<!--@ item1 0 0 0 0-->
Q1
---
A1
<!--@ item2 5.2 4.3 2 0 2025-01-04T10:30:00Z-->
Q2
---
A2
`;
      const result = yield* parseFile(content);

      assert.strictEqual(result.preamble, "");
      assert.strictEqual(result.items.length, 2);

      const item1 = result.items[0]!;
      assert.strictEqual(item1.cards[0]!.id, "item1");
      assert.strictEqual(item1.cards[0]!.state, 0);
      assert.strictEqual(item1.cards[0]!.lastReview, null);
      assert.strictEqual(item1.cards[0]!.due, null);

      const item2 = result.items[1]!;
      assert.strictEqual(item2.cards[0]!.id, "item2");
      assert.strictEqual(item2.cards[0]!.stability.value, 5.2);
      assert.strictEqual(item2.cards[0]!.stability.raw, "5.2");
      assert.strictEqual(item2.cards[0]!.difficulty.value, 4.3);
      assert.strictEqual(item2.cards[0]!.state, 2);
      assert.ok(item2.cards[0]!.lastReview instanceof Date);
      assert.strictEqual(item2.cards[0]!.due, null);
    }),
  );

  it.scoped("parses reviewed card with explicit due timestamp", () =>
    Effect.gen(function* () {
      const content = `<!--@ item2 5.2 4.3 2 0 2025-01-04T10:30:00Z 2025-01-09T10:30:00Z-->
Q2
---
A2
`;
      const result = yield* parseFile(content);
      const card = result.items[0]!.cards[0]!;
      assert.ok(card.lastReview instanceof Date);
      assert.ok(card.due instanceof Date);
      assert.strictEqual(card.lastReview?.toISOString(), "2025-01-04T10:30:00.000Z");
      assert.strictEqual(card.due?.toISOString(), "2025-01-09T10:30:00.000Z");
    }),
  );

  it.scoped("parses file with no items (preamble only)", () =>
    Effect.gen(function* () {
      const content = `This is just some text.
No flashcards here.
`;
      const result = yield* parseFile(content);

      assert.strictEqual(result.preamble, content);
      assert.strictEqual(result.items.length, 0);
    }),
  );

  it.scoped("handles empty file", () =>
    Effect.gen(function* () {
      const result = yield* parseFile("");

      assert.strictEqual(result.preamble, "");
      assert.strictEqual(result.items.length, 0);
    }),
  );

  it.scoped("handles consecutive metadata lines as multi-card item", () =>
    Effect.gen(function* () {
      const content = `<!--@ item1 0 0 0 0-->
<!--@ item2 0 0 0 0-->
Content for both cards
`;
      const result = yield* parseFile(content);

      // Consecutive metadata lines → one item with two cards
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]!.cards.length, 2);
      assert.strictEqual(result.items[0]!.cards[0]!.id, "item1");
      assert.strictEqual(result.items[0]!.cards[1]!.id, "item2");
      assert.strictEqual(
        result.items[0]!.content,
        `Content for both cards
`,
      );
    }),
  );

  it.scoped("preserves CRLF in content", () =>
    Effect.gen(function* () {
      const content = "<!--@ abc123 0 0 0 0-->\nLine1\r\nLine2\r\n";
      const result = yield* parseFile(content);

      assert.strictEqual(result.items[0]!.content, "Line1\r\nLine2\r\n");
    }),
  );

  it.scoped("handles file without trailing newline", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 0 0 0 0-->
Content without trailing newline`;
      const result = yield* parseFile(content);

      assert.strictEqual(result.items[0]!.content, "Content without trailing newline");
    }),
  );

  it.scoped("preserves numeric precision", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 5.20 4.30 2 0 2025-01-04T10:30:00Z-->
Content
`;
      const result = yield* parseFile(content);

      const card = result.items[0]!.cards[0]!;
      assert.strictEqual(card.stability.raw, "5.20");
      assert.strictEqual(card.difficulty.raw, "4.30");
    }),
  );

  it.scoped("fails on invalid field count", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 0 0-->
Content
`;
      const error = yield* parseFile(content).pipe(Effect.flip);
      assert.ok(error._tag === "InvalidMetadataFormat");
    }),
  );

  it.scoped("fails on invalid numeric value", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 invalid 0 0 0-->
Content
`;
      const error = yield* parseFile(content).pipe(Effect.flip);
      assert.ok(error._tag === "InvalidFieldValue");
    }),
  );

  it.scoped("fails on invalid state", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 0 0 5 0-->
Content
`;
      const error = yield* parseFile(content).pipe(Effect.flip);
      assert.ok(error._tag === "InvalidFieldValue");
    }),
  );

  it.scoped("fails on timestamp without timezone", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 0 0 0 0 2025-01-04T10:30:00-->
Content
`;
      const error = yield* parseFile(content).pipe(Effect.flip);
      assert.ok(error._tag === "InvalidFieldValue");
    }),
  );

  it.scoped("fails on due timestamp without timezone", () =>
    Effect.gen(function* () {
      const content = `<!--@ abc123 0 0 2 0 2025-01-04T10:30:00Z 2025-01-06T10:30:00-->
Content
`;
      const error = yield* parseFile(content).pipe(Effect.flip);
      assert.ok(error._tag === "InvalidFieldValue");
    }),
  );

  it.scoped("handles CRLF metadata lines", () =>
    Effect.gen(function* () {
      // Simulating CRLF line endings - when split on \n, lines have trailing \r
      const content = "<!--@ abc123 0 0 0 0-->\r\nContent\r\n";
      const result = yield* parseFile(content);

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]!.cards[0]!.id, "abc123");
    }),
  );
});
