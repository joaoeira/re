import { describe, it, expect } from "vitest";
import type { DuplicateMap } from "@re/workspace";
import { formatDuplicates } from "../src/check-duplicates";

describe("check-duplicates formatting", () => {
  it("formats single duplicate", () => {
    const duplicates: DuplicateMap = {
      abc: [
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        { filePath: "/deck2.md", itemIndex: 1, cardIndex: 0, id: "abc" },
      ],
    };

    const result = formatDuplicates(duplicates);

    expect(result).toContain("Duplicate ID: abc");
    expect(result).toContain("/deck1.md (item 0, card 0)");
    expect(result).toContain("/deck2.md (item 1, card 0)");
    expect(result).toContain("Found 1 duplicate ID(s)");
  });

  it("formats multiple duplicates", () => {
    const duplicates: DuplicateMap = {
      abc: [
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "abc" },
      ],
      def: [
        { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "def" },
        { filePath: "/deck3.md", itemIndex: 0, cardIndex: 0, id: "def" },
      ],
    };

    const result = formatDuplicates(duplicates);

    expect(result).toContain("Found 2 duplicate ID(s)");
  });

  it("returns message when no duplicates", () => {
    expect(formatDuplicates({})).toBe("No duplicate IDs found");
  });
});
