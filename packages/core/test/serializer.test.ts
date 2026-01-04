import { describe, it, assert } from "@effect/vitest";
import { serializeFile, serializeMetadata } from "../src/serializer/index.ts";
import type { ItemMetadata, ParsedFile, ItemId, State } from "../src/types.ts";

describe("serializeMetadata", () => {
  it("serializes new item metadata", () => {
    const metadata: ItemMetadata = {
      id: "abc123" as ItemId,
      stability: { value: 0, raw: "0" },
      difficulty: { value: 0, raw: "0" },
      state: 0 as State,
      learningSteps: 0,
      lastReview: null,
    };

    const result = serializeMetadata(metadata);
    assert.strictEqual(result, "<!--@ abc123 0 0 0 0-->");
  });

  it("serializes reviewed item metadata", () => {
    const metadata: ItemMetadata = {
      id: "abc123" as ItemId,
      stability: { value: 5.2, raw: "5.20" },
      difficulty: { value: 4.3, raw: "4.30" },
      state: 2 as State,
      learningSteps: 0,
      lastReview: new Date("2025-01-04T10:30:00Z"),
    };

    const result = serializeMetadata(metadata);
    assert.strictEqual(
      result,
      "<!--@ abc123 5.20 4.30 2 0 2025-01-04T10:30:00.000Z-->"
    );
  });

  it("preserves numeric precision from raw", () => {
    const metadata: ItemMetadata = {
      id: "abc123" as ItemId,
      stability: { value: 5.2, raw: "5.200" },
      difficulty: { value: 4.3, raw: "4.300" },
      state: 2 as State,
      learningSteps: 0,
      lastReview: null,
    };

    const result = serializeMetadata(metadata);
    assert.ok(result.includes("5.200"));
    assert.ok(result.includes("4.300"));
  });

  it("canonicalizes timestamp to UTC", () => {
    const metadata: ItemMetadata = {
      id: "abc123" as ItemId,
      stability: { value: 0, raw: "0" },
      difficulty: { value: 0, raw: "0" },
      state: 2 as State,
      learningSteps: 0,
      lastReview: new Date("2025-01-04T12:30:00+02:00"), // 10:30 UTC
    };

    const result = serializeMetadata(metadata);
    assert.ok(result.includes("2025-01-04T10:30:00.000Z"));
  });
});

describe("serializeFile", () => {
  it("serializes file with preamble and items", () => {
    const file: ParsedFile = {
      preamble: "---\ntitle: Test\n---\n\n",
      items: [
        {
          cards: [
            {
              id: "item1" as ItemId,
              stability: { value: 0, raw: "0" },
              difficulty: { value: 0, raw: "0" },
              state: 0 as State,
              learningSteps: 0,
              lastReview: null,
            },
          ],
          content: "Q1\n---\nA1\n",
        },
      ],
    };

    const result = serializeFile(file);
    assert.strictEqual(
      result,
      "---\ntitle: Test\n---\n\n<!--@ item1 0 0 0 0-->\nQ1\n---\nA1\n"
    );
  });

  it("serializes file without preamble", () => {
    const file: ParsedFile = {
      preamble: "",
      items: [
        {
          cards: [
            {
              id: "item1" as ItemId,
              stability: { value: 0, raw: "0" },
              difficulty: { value: 0, raw: "0" },
              state: 0 as State,
              learningSteps: 0,
              lastReview: null,
            },
          ],
          content: "Content\n",
        },
      ],
    };

    const result = serializeFile(file);
    assert.strictEqual(result, "<!--@ item1 0 0 0 0-->\nContent\n");
  });

  it("serializes file with multiple items", () => {
    const file: ParsedFile = {
      preamble: "",
      items: [
        {
          cards: [
            {
              id: "item1" as ItemId,
              stability: { value: 0, raw: "0" },
              difficulty: { value: 0, raw: "0" },
              state: 0 as State,
              learningSteps: 0,
              lastReview: null,
            },
          ],
          content: "Q1\n",
        },
        {
          cards: [
            {
              id: "item2" as ItemId,
              stability: { value: 5.2, raw: "5.2" },
              difficulty: { value: 4.3, raw: "4.3" },
              state: 2 as State,
              learningSteps: 0,
              lastReview: new Date("2025-01-04T10:30:00Z"),
            },
          ],
          content: "Q2\n",
        },
      ],
    };

    const result = serializeFile(file);
    assert.ok(result.includes("<!--@ item1 0 0 0 0-->"));
    assert.ok(
      result.includes("<!--@ item2 5.2 4.3 2 0 2025-01-04T10:30:00.000Z-->")
    );
  });

  it("handles empty items array", () => {
    const file: ParsedFile = {
      preamble: "Just preamble\n",
      items: [],
    };

    const result = serializeFile(file);
    assert.strictEqual(result, "Just preamble\n");
  });
});
