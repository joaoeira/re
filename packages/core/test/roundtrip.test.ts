import { Effect } from "effect";
import { describe, it, assert } from "@effect/vitest";
import { parseFile } from "../src/parser/index.ts";
import { serializeFile } from "../src/serializer/index.ts";

describe("round-trip", () => {
  it.scoped("preserves content byte-perfect", () =>
    Effect.gen(function* () {
      const original = `<!--@ abc123 0 0 0 0-->
What is the capital of France?
---
Paris
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves preamble byte-perfect", () =>
    Effect.gen(function* () {
      const original = `---
title: My Flashcards
tags: [test, example]
---

Some intro text here.

<!--@ abc123 0 0 0 0-->
Q1
---
A1
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves numeric precision", () =>
    Effect.gen(function* () {
      const original = `<!--@ abc123 5.20 4.30 2 0 2025-01-04T10:30:00.000Z-->
Content
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("canonicalizes timestamps to UTC", () =>
    Effect.gen(function* () {
      // Input with +02:00 offset
      const original = `<!--@ abc123 0 0 2 0 2025-01-04T12:30:00+02:00-->
Content
`;
      // Expected output with UTC
      const expected = `<!--@ abc123 0 0 2 0 2025-01-04T10:30:00.000Z-->
Content
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, expected);
    })
  );

  it.scoped("preserves multiple items", () =>
    Effect.gen(function* () {
      const original = `<!--@ item1 0 0 0 0-->
Q1
---
A1
<!--@ item2 5.2 4.3 2 0 2025-01-04T10:30:00.000Z-->
Q2
---
A2
<!--@ item3 1.5 2.5 1 2-->
Q3
---
A3
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves CRLF in content", () =>
    Effect.gen(function* () {
      const original = "<!--@ abc123 0 0 0 0-->\nLine1\r\nLine2\r\n";
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves content without trailing newline", () =>
    Effect.gen(function* () {
      const original = `<!--@ abc123 0 0 0 0-->
Content without trailing newline`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves empty content between items", () =>
    Effect.gen(function* () {
      const original = `<!--@ item1 0 0 0 0-->
<!--@ item2 0 0 0 0-->
Content
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves horizontal rules in content", () =>
    Effect.gen(function* () {
      const original = `<!--@ abc123 0 0 0 0-->
Question here
---
Answer here
---
More content
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves code fences in content", () =>
    Effect.gen(function* () {
      const original = `<!--@ abc123 0 0 0 0-->
What does this code do?

\`\`\`javascript
function add(a, b) {
  return a + b;
}
\`\`\`

---

It adds two numbers.
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );

  it.scoped("preserves preamble-only files", () =>
    Effect.gen(function* () {
      const original = `This is just a regular file.
No flashcards here.
Just text.
`;
      const parsed = yield* parseFile(original);
      const serialized = serializeFile(parsed);

      assert.strictEqual(serialized, original);
    })
  );
});
