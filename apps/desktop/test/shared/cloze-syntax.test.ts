import { describe, expect, it } from "vitest";

import { nextClozeDeletionIndex, parseClozeDeletions, replaceClozeDeletions } from "@re/core";

describe("shared cloze syntax helpers", () => {
  it("computes next index from open cloze markers while typing", () => {
    expect(nextClozeDeletionIndex("{{c3::unfinished")).toBe(4);
    expect(nextClozeDeletionIndex("{{c3::unfinished and {{c7::")).toBe(8);
  });

  it("keeps only the first hint segment when multiple :: separators are present", () => {
    const parsed = parseClozeDeletions("{{c1::answer::hint-a::hint-b}}");

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.hidden).toBe("answer");
    expect(parsed[0]?.hint).toBe("hint-a");
  });

  it("returns the original content when replace is called without parsed clozes", () => {
    const input = "text {{c2::unfinished";
    const output = replaceClozeDeletions(input, () => "[x]");

    expect(output).toBe(input);
  });

  it("does not parse clozes containing a closing brace in hidden content", () => {
    expect(parseClozeDeletions("{{c1::a}b}}")).toEqual([]);
  });
});
