import { Effect } from "effect";
import { describe, it, assert } from "@effect/vitest";
import { parseFile } from "../src/parser/index.ts";
import { serializeFile } from "../src/serializer/index.ts";

describe("multi-card items", () => {
  describe("parsing", () => {
    it.scoped("parses consecutive metadata lines as one item with multiple cards", () =>
      Effect.gen(function* () {
        const content = `<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 0 0-->
The atomic number of [carbon] is [6].
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0]!.cards.length, 2);
        assert.strictEqual(result.items[0]!.cards[0]!.id, "card1");
        assert.strictEqual(result.items[0]!.cards[1]!.id, "card2");
        assert.strictEqual(result.items[0]!.content, "The atomic number of [carbon] is [6].\n");
      }),
    );

    it.scoped("parses three consecutive metadata lines as one item with three cards", () =>
      Effect.gen(function* () {
        const content = `<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 0 0-->
<!--@ card3 0 0 0 0-->
[Paris] is the capital of [France] in [Europe].
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0]!.cards.length, 3);
        assert.strictEqual(result.items[0]!.cards[0]!.id, "card1");
        assert.strictEqual(result.items[0]!.cards[1]!.id, "card2");
        assert.strictEqual(result.items[0]!.cards[2]!.id, "card3");
      }),
    );

    it.scoped("blank line between metadata lines breaks grouping", () =>
      Effect.gen(function* () {
        const content = `<!--@ card1 0 0 0 0-->

<!--@ card2 0 0 0 0-->
Content for card2
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 2);
        assert.strictEqual(result.items[0]!.cards.length, 1);
        assert.strictEqual(result.items[0]!.cards[0]!.id, "card1");
        assert.strictEqual(result.items[0]!.content, "\n");
        assert.strictEqual(result.items[1]!.cards.length, 1);
        assert.strictEqual(result.items[1]!.cards[0]!.id, "card2");
        assert.strictEqual(result.items[1]!.content, "Content for card2\n");
      }),
    );

    it.scoped("single metadata line creates item with one card (backwards compatible)", () =>
      Effect.gen(function* () {
        const content = `<!--@ abc123 0 0 0 0-->
What is the capital of France?
---
Paris
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0]!.cards.length, 1);
        assert.strictEqual(result.items[0]!.cards[0]!.id, "abc123");
      }),
    );

    it.scoped("mixed single and multi-card items", () =>
      Effect.gen(function* () {
        const content = `<!--@ single1 0 0 0 0-->
Regular flashcard Q1
---
A1
<!--@ multi1 0 0 0 0-->
<!--@ multi2 0 0 0 0-->
The [sun] rises in the [east].
<!--@ single2 5.2 4.3 2 0 2025-01-04T10:30:00Z-->
Regular flashcard Q2
---
A2
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 3);

        // First item: single card
        assert.strictEqual(result.items[0]!.cards.length, 1);
        assert.strictEqual(result.items[0]!.cards[0]!.id, "single1");

        // Second item: two cards sharing content
        assert.strictEqual(result.items[1]!.cards.length, 2);
        assert.strictEqual(result.items[1]!.cards[0]!.id, "multi1");
        assert.strictEqual(result.items[1]!.cards[1]!.id, "multi2");
        assert.strictEqual(result.items[1]!.content, "The [sun] rises in the [east].\n");

        // Third item: single card
        assert.strictEqual(result.items[2]!.cards.length, 1);
        assert.strictEqual(result.items[2]!.cards[0]!.id, "single2");
      }),
    );

    it.scoped("preserves individual card metadata in multi-card item", () =>
      Effect.gen(function* () {
        const content = `<!--@ card1 1.5 2.5 1 0-->
<!--@ card2 5.2 4.3 2 1 2025-01-04T10:30:00Z-->
Shared content
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 1);
        const item = result.items[0]!;

        assert.strictEqual(item.cards[0]!.id, "card1");
        assert.strictEqual(item.cards[0]!.stability.value, 1.5);
        assert.strictEqual(item.cards[0]!.difficulty.value, 2.5);
        assert.strictEqual(item.cards[0]!.state, 1);
        assert.strictEqual(item.cards[0]!.lastReview, null);

        assert.strictEqual(item.cards[1]!.id, "card2");
        assert.strictEqual(item.cards[1]!.stability.value, 5.2);
        assert.strictEqual(item.cards[1]!.difficulty.value, 4.3);
        assert.strictEqual(item.cards[1]!.state, 2);
        assert.ok(item.cards[1]!.lastReview instanceof Date);
      }),
    );

    it.scoped("multi-card item with preamble", () =>
      Effect.gen(function* () {
        const content = `---
title: Chemistry Notes
---

<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 0 0-->
The atomic number of [carbon] is [6].
`;
        const result = yield* parseFile(content);

        assert.strictEqual(
          result.preamble,
          `---
title: Chemistry Notes
---

`,
        );
        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0]!.cards.length, 2);
      }),
    );

    it.scoped("multiple multi-card items in sequence", () =>
      Effect.gen(function* () {
        const content = `<!--@ a1 0 0 0 0-->
<!--@ a2 0 0 0 0-->
First cloze: [foo] and [bar]
<!--@ b1 0 0 0 0-->
<!--@ b2 0 0 0 0-->
<!--@ b3 0 0 0 0-->
Second cloze: [x], [y], and [z]
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 2);
        assert.strictEqual(result.items[0]!.cards.length, 2);
        assert.strictEqual(result.items[1]!.cards.length, 3);
      }),
    );

    it.scoped("multi-card item at EOF with empty content", () =>
      Effect.gen(function* () {
        const content = `<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 0 0-->`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0]!.cards.length, 2);
        assert.strictEqual(result.items[0]!.cards[0]!.id, "card1");
        assert.strictEqual(result.items[0]!.cards[1]!.id, "card2");
        assert.strictEqual(result.items[0]!.content, "");
      }),
    );

    it.scoped("multi-card item followed by single-card item (no blank line between)", () =>
      Effect.gen(function* () {
        // Content breaks the first group, then a new item starts
        const content = `<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 0 0-->
Shared cloze content
<!--@ single 0 0 0 0-->
Regular flashcard
`;
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 2);
        assert.strictEqual(result.items[0]!.cards.length, 2);
        assert.strictEqual(result.items[0]!.content, "Shared cloze content\n");
        assert.strictEqual(result.items[1]!.cards.length, 1);
        assert.strictEqual(result.items[1]!.cards[0]!.id, "single");
      }),
    );

    it.scoped("handles CRLF in metadata lines", () =>
      Effect.gen(function* () {
        // Metadata lines with CRLF endings
        const content = "<!--@ card1 0 0 0 0-->\r\n<!--@ card2 0 0 0 0-->\r\nContent\r\n";
        const result = yield* parseFile(content);

        assert.strictEqual(result.items.length, 1);
        assert.strictEqual(result.items[0]!.cards.length, 2);
        assert.strictEqual(result.items[0]!.cards[0]!.id, "card1");
        assert.strictEqual(result.items[0]!.cards[1]!.id, "card2");
      }),
    );
  });

  describe("serialization", () => {
    it.scoped("serializes multi-card item with all metadata lines before content", () =>
      Effect.gen(function* () {
        const original = `<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 0 0-->
The atomic number of [carbon] is [6].
`;
        const parsed = yield* parseFile(original);
        const serialized = serializeFile(parsed);

        assert.strictEqual(serialized, original);
      }),
    );

    it.scoped("serializes mixed single and multi-card items", () =>
      Effect.gen(function* () {
        const original = `<!--@ single 0 0 0 0-->
Regular card
<!--@ multi1 0 0 0 0-->
<!--@ multi2 0 0 0 0-->
Cloze card
`;
        const parsed = yield* parseFile(original);
        const serialized = serializeFile(parsed);

        assert.strictEqual(serialized, original);
      }),
    );

    it.scoped("preserves card order in multi-card items", () =>
      Effect.gen(function* () {
        const original = `<!--@ first 1.0 2.0 1 0-->
<!--@ second 3.0 4.0 2 0-->
<!--@ third 5.0 6.0 0 0-->
Content
`;
        const parsed = yield* parseFile(original);
        const serialized = serializeFile(parsed);

        assert.strictEqual(serialized, original);

        // Verify order is preserved
        const reparsed = yield* parseFile(serialized);
        assert.strictEqual(reparsed.items[0]!.cards[0]!.id, "first");
        assert.strictEqual(reparsed.items[0]!.cards[1]!.id, "second");
        assert.strictEqual(reparsed.items[0]!.cards[2]!.id, "third");
      }),
    );
  });

  describe("round-trip", () => {
    it.scoped("round-trips multi-card items byte-perfect", () =>
      Effect.gen(function* () {
        const original = `<!--@ card1 5.20 4.30 2 1 2025-01-04T10:30:00.000Z-->
<!--@ card2 1.50 2.50 0 0-->
The atomic number of [carbon] is [6].
`;
        const parsed = yield* parseFile(original);
        const serialized = serializeFile(parsed);

        assert.strictEqual(serialized, original);
      }),
    );

    it.scoped("round-trips complex file with preamble, single, and multi-card items", () =>
      Effect.gen(function* () {
        const original = `---
title: Chemistry & Geography
tags: [science, cloze]
---

# Introduction

Some intro text.

<!--@ q1 0 0 0 0-->
What is H2O?
---
Water

<!--@ cloze1-carbon 0 0 0 0-->
<!--@ cloze1-six 0 0 0 0-->
The atomic number of [carbon] is [6].

<!--@ cloze2-paris 2.5 3.5 1 0-->
<!--@ cloze2-france 5.0 4.0 2 1 2025-01-04T10:30:00.000Z-->
[Paris] is the capital of [France].

<!--@ q2 0 0 0 0-->
What is the speed of light?
---
299,792,458 m/s
`;
        const parsed = yield* parseFile(original);
        const serialized = serializeFile(parsed);

        assert.strictEqual(serialized, original);
      }),
    );

    it.scoped("round-trips preserving CRLF in multi-card content", () =>
      Effect.gen(function* () {
        const original = "<!--@ card1 0 0 0 0-->\n<!--@ card2 0 0 0 0-->\nLine1\r\nLine2\r\n";
        const parsed = yield* parseFile(original);
        const serialized = serializeFile(parsed);

        assert.strictEqual(serialized, original);
      }),
    );
  });

  describe("error handling", () => {
    it.scoped("fails if any card in multi-card item has invalid metadata", () =>
      Effect.gen(function* () {
        const content = `<!--@ card1 0 0 0 0-->
<!--@ card2 invalid 0 0 0-->
Content
`;
        const error = yield* parseFile(content).pipe(Effect.flip);
        assert.ok(error._tag === "InvalidFieldValue");
      }),
    );

    it.scoped("fails if any card in multi-card item has invalid state", () =>
      Effect.gen(function* () {
        const content = `<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 99 0-->
Content
`;
        const error = yield* parseFile(content).pipe(Effect.flip);
        assert.ok(error._tag === "InvalidFieldValue");
      }),
    );
  });
});
