import { describe, it, assert } from "@effect/vitest";
import { generateId, createMetadata, createMetadataWithId, numericField } from "../src/create.ts";
import type { ItemId } from "../src/types.ts";

describe("generateId", () => {
  it("generates a non-empty string", () => {
    const id = generateId();
    assert.ok(id.length > 0);
  });

  it("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    assert.strictEqual(ids.size, 100);
  });
});

describe("numericField", () => {
  it("creates field with integer", () => {
    const field = numericField(5);
    assert.strictEqual(field.value, 5);
    assert.strictEqual(field.raw, "5");
  });

  it("creates field with decimal", () => {
    const field = numericField(5.2);
    assert.strictEqual(field.value, 5.2);
    assert.strictEqual(field.raw, "5.2");
  });

  it("creates field with zero", () => {
    const field = numericField(0);
    assert.strictEqual(field.value, 0);
    assert.strictEqual(field.raw, "0");
  });
});

describe("createMetadata", () => {
  it("creates new item metadata", () => {
    const metadata = createMetadata();

    assert.ok(metadata.id.length > 0);
    assert.strictEqual(metadata.stability.value, 0);
    assert.strictEqual(metadata.difficulty.value, 0);
    assert.strictEqual(metadata.state, 0);
    assert.strictEqual(metadata.learningSteps, 0);
    assert.strictEqual(metadata.lastReview, null);
    assert.strictEqual(metadata.due, null);
  });

  it("generates unique IDs", () => {
    const m1 = createMetadata();
    const m2 = createMetadata();
    assert.notStrictEqual(m1.id, m2.id);
  });
});

describe("createMetadataWithId", () => {
  it("creates metadata with specified ID", () => {
    const metadata = createMetadataWithId("custom-id" as ItemId);

    assert.strictEqual(metadata.id, "custom-id");
    assert.strictEqual(metadata.stability.value, 0);
    assert.strictEqual(metadata.difficulty.value, 0);
    assert.strictEqual(metadata.state, 0);
    assert.strictEqual(metadata.learningSteps, 0);
    assert.strictEqual(metadata.lastReview, null);
    assert.strictEqual(metadata.due, null);
  });
});
