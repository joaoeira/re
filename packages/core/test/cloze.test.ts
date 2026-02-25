import { describe, it, assert } from "@effect/vitest";
import {
  hasClozeDeletion,
  nextClozeDeletionIndex,
  parseClozeDeletions,
  replaceClozeDeletions,
} from "../src/cloze.ts";

describe("cloze helpers", () => {
  it("detects cloze syntax", () => {
    assert.strictEqual(hasClozeDeletion("plain text"), false);
    assert.strictEqual(hasClozeDeletion("{{c1::answer}}"), true);
    assert.strictEqual(hasClozeDeletion("{{c::invalid}}"), false);
  });

  it("parses cloze syntax with optional hint", () => {
    const parsed = parseClozeDeletions("The {{c2::Paris::capital city}} is {{c3::France}}.");

    assert.strictEqual(parsed.length, 2);

    assert.strictEqual(parsed[0]!.index, 2);
    assert.strictEqual(parsed[0]!.hidden, "Paris");
    assert.strictEqual(parsed[0]!.hint, "capital city");
    assert.strictEqual(parsed[0]!.start, 4);
    assert.strictEqual(parsed[0]!.end, 29);

    assert.strictEqual(parsed[1]!.index, 3);
    assert.strictEqual(parsed[1]!.hidden, "France");
    assert.strictEqual(parsed[1]!.hint, null);
  });

  it("keeps only the first hint segment when multiple separators are present", () => {
    const parsed = parseClozeDeletions("{{c1::answer::hint-a::hint-b}}");

    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0]!.hidden, "answer");
    assert.strictEqual(parsed[0]!.hint, "hint-a");
  });

  it("treats empty hint as absent", () => {
    const parsed = parseClozeDeletions("{{c1::Paris::}}");
    assert.strictEqual(parsed[0]!.hidden, "Paris");
    assert.strictEqual(parsed[0]!.hint, null);
  });

  it("ignores incomplete cloze syntax while parsing", () => {
    const parsed = parseClozeDeletions("start {{c3::unfinished");
    assert.strictEqual(parsed.length, 0);
  });

  it("does not parse clozes containing a closing brace inside hidden content", () => {
    const parsed = parseClozeDeletions("{{c1::a}b}}");
    assert.strictEqual(parsed.length, 0);
  });

  it("computes the next cloze index", () => {
    assert.strictEqual(nextClozeDeletionIndex("{{c3::a}} {{c1::b}}"), 4);
    assert.strictEqual(nextClozeDeletionIndex("plain text"), 1);
    assert.strictEqual(nextClozeDeletionIndex("{{c3::unfinished"), 4);
    assert.strictEqual(nextClozeDeletionIndex("{{c3::unfinished {{c7::"), 8);
  });

  it("replaces cloze blocks while preserving surrounding text", () => {
    const output = replaceClozeDeletions("A {{c1::x}} and {{c2::y::hint}}", (deletion) =>
      deletion.hint ? `[${deletion.hint}]` : `[${deletion.hidden}]`,
    );

    assert.strictEqual(output, "A [x] and [hint]");
  });

  it("returns input unchanged when no cloze syntax is parsed", () => {
    const input = "plain text {{c1::unfinished";
    const output = replaceClozeDeletions(input, () => "[x]");

    assert.strictEqual(output, input);
  });
});
