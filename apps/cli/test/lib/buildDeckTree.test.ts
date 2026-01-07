import { describe, it, expect } from "vitest"
import { buildDeckTree } from "../../src/lib/buildDeckTree"
import type { DeckStats } from "../../src/services/DeckLoader"
import { Path } from "@effect/platform"
import { Effect } from "effect"

const path = Effect.runSync(Effect.provide(Path.Path, Path.layer))

const makeDeckStats = (path: string): DeckStats => ({
  path,
  name: path.split("/").pop()!.replace(".md", ""),
  totalCards: 10,
  newCards: 3,
  dueCards: 2,
  isEmpty: false,
  parseError: null,
})

describe("buildDeckTree", () => {
  it("builds flat tree from single level", () => {
    const decks = [makeDeckStats("/root/a.md"), makeDeckStats("/root/b.md")]
    const result = buildDeckTree(decks, "/root", path)

    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe("deck")
    expect(result[1]!.type).toBe("deck")
  })

  it("builds nested tree from subdirectories", () => {
    const decks = [
      makeDeckStats("/root/book1/chapter1.md"),
      makeDeckStats("/root/book1/chapter2.md"),
      makeDeckStats("/root/notes.md"),
    ]
    const result = buildDeckTree(decks, "/root", path)

    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe("folder")
    if (result[0]!.type === "folder") {
      expect(result[0]!.name).toBe("book1")
      expect(result[0]!.children).toHaveLength(2)
    }
    expect(result[1]!.type).toBe("deck")
  })

  it("handles deeply nested folders", () => {
    const decks = [makeDeckStats("/root/a/b/c/deck.md")]
    const result = buildDeckTree(decks, "/root", path)

    expect(result).toHaveLength(1)
    expect(result[0]!.type).toBe("folder")
    if (result[0]!.type === "folder") {
      expect(result[0]!.name).toBe("a")
      expect(result[0]!.children[0]!.type).toBe("folder")
    }
  })
})
