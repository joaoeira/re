import { describe, expect, it } from "vitest";
import { Option } from "effect";

import {
  buildEditorContent,
  isSameEditorRequest,
  normalizeDeckPathFromSearch,
  toDuplicateStatus,
  toErrorMessage,
} from "@shared/state/editor-utils";

describe("buildEditorContent", () => {
  it("joins front and back with separator for QA", () => {
    const result = buildEditorContent({
      cardType: "qa",
      frontContent: "question",
      backContent: "answer",
    });
    expect(result).toBe("question\n---\nanswer");
  });

  it("returns null when front is empty for QA", () => {
    expect(
      buildEditorContent({ cardType: "qa", frontContent: "", backContent: "answer" }),
    ).toBeNull();
  });

  it("returns null when back is empty for QA", () => {
    expect(
      buildEditorContent({ cardType: "qa", frontContent: "question", backContent: "" }),
    ).toBeNull();
  });

  it("returns null when both empty for QA", () => {
    expect(buildEditorContent({ cardType: "qa", frontContent: "", backContent: "" })).toBeNull();
  });

  it("returns null for whitespace-only QA content", () => {
    expect(
      buildEditorContent({ cardType: "qa", frontContent: "  \n  ", backContent: "  \t  " }),
    ).toBeNull();
  });

  it("trims before joining for QA", () => {
    const result = buildEditorContent({
      cardType: "qa",
      frontContent: "  question  ",
      backContent: "  answer  ",
    });
    expect(result).toBe("question\n---\nanswer");
  });

  it("preserves inner newlines in QA content", () => {
    const result = buildEditorContent({
      cardType: "qa",
      frontContent: "line1\nline2",
      backContent: "a\nb",
    });
    expect(result).toBe("line1\nline2\n---\na\nb");
  });

  it("returns frontContent for non-empty cloze", () => {
    expect(
      buildEditorContent({
        cardType: "cloze",
        frontContent: "{{c1::answer}}",
        backContent: "",
      }),
    ).toBe("{{c1::answer}}");
  });

  it("returns null for empty cloze", () => {
    expect(buildEditorContent({ cardType: "cloze", frontContent: "", backContent: "" })).toBeNull();
  });

  it("returns null for whitespace-only cloze", () => {
    expect(
      buildEditorContent({ cardType: "cloze", frontContent: "   ", backContent: "" }),
    ).toBeNull();
  });
});

describe("normalizeDeckPathFromSearch", () => {
  const decks = [
    { absolutePath: "/workspace/deck-a.md", relativePath: "deck-a.md" },
    { absolutePath: "/workspace/sub/deck-b.md", relativePath: "sub/deck-b.md" },
  ];

  it("returns null for undefined", () => {
    expect(normalizeDeckPathFromSearch(undefined, decks)).toBeNull();
  });

  it("returns absolutePath for absolute match", () => {
    expect(normalizeDeckPathFromSearch("/workspace/deck-a.md", decks)).toBe("/workspace/deck-a.md");
  });

  it("resolves relative path to absolutePath", () => {
    expect(normalizeDeckPathFromSearch("sub/deck-b.md", decks)).toBe("/workspace/sub/deck-b.md");
  });

  it("passes through unmatched value", () => {
    expect(normalizeDeckPathFromSearch("/unknown/path.md", decks)).toBe("/unknown/path.md");
  });

  it("returns null for empty string", () => {
    expect(normalizeDeckPathFromSearch("", decks)).toBeNull();
  });
});

describe("toDuplicateStatus", () => {
  it("converts Some to string", () => {
    const result = toDuplicateStatus({
      isDuplicate: true,
      matchingDeckPath: Option.some("/deck.md"),
    });
    expect(result).toEqual({ isDuplicate: true, matchingDeckPath: "/deck.md" });
  });

  it("converts None to null", () => {
    const result = toDuplicateStatus({
      isDuplicate: false,
      matchingDeckPath: Option.none(),
    });
    expect(result).toEqual({ isDuplicate: false, matchingDeckPath: null });
  });
});

describe("toErrorMessage", () => {
  it("extracts message from Error", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(toErrorMessage("string error")).toBe("string error");
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
  });
});

describe("isSameEditorRequest", () => {
  it("matches create requests with same deckPath", () => {
    expect(
      isSameEditorRequest(
        { mode: "create", deckPath: "/a.md" },
        { mode: "create", deckPath: "/a.md" },
      ),
    ).toBe(true);
  });

  it("matches create requests with no deckPath", () => {
    expect(isSameEditorRequest({ mode: "create" }, { mode: "create" })).toBe(true);
  });

  it("rejects create requests with different deckPath", () => {
    expect(
      isSameEditorRequest(
        { mode: "create", deckPath: "/a.md" },
        { mode: "create", deckPath: "/b.md" },
      ),
    ).toBe(false);
  });

  it("matches edit requests with same deckPath and cardId", () => {
    expect(
      isSameEditorRequest(
        { mode: "edit", deckPath: "/a.md", cardId: "c1" },
        { mode: "edit", deckPath: "/a.md", cardId: "c1" },
      ),
    ).toBe(true);
  });

  it("rejects edit requests with different cardId", () => {
    expect(
      isSameEditorRequest(
        { mode: "edit", deckPath: "/a.md", cardId: "c1" },
        { mode: "edit", deckPath: "/a.md", cardId: "c2" },
      ),
    ).toBe(false);
  });

  it("rejects edit requests with different deckPath", () => {
    expect(
      isSameEditorRequest(
        { mode: "edit", deckPath: "/a.md", cardId: "c1" },
        { mode: "edit", deckPath: "/b.md", cardId: "c1" },
      ),
    ).toBe(false);
  });

  it("rejects mismatched modes", () => {
    expect(
      isSameEditorRequest(
        { mode: "create", deckPath: "/a.md" },
        { mode: "edit", deckPath: "/a.md", cardId: "c1" },
      ),
    ).toBe(false);
  });
});
