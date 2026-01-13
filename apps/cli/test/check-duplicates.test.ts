import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { FileSystem, Path } from "@effect/platform"
import { SystemError } from "@effect/platform/Error"
import {
  extractCardLocations,
  findDuplicates,
  formatDuplicates,
  type CardLocation,
} from "../src/check-duplicates"
import type { ParsedDeck } from "../src/services"

const makeCard = (id: string) => ({
  id,
  stability: { value: 0, raw: "0" },
  difficulty: { value: 0, raw: "0" },
  state: 0 as const,
  learningSteps: 0,
  lastReview: null,
})

const makeDeck = (path: string, cards: { itemIndex: number; cardIds: string[] }[]): ParsedDeck => ({
  path,
  name: path.split("/").pop()?.replace(".md", "") ?? "",
  file: {
    preamble: "",
    items: cards.map(({ cardIds }) => ({
      cards: cardIds.map(makeCard),
      content: "Q\n---\nA",
    })),
  },
})

describe("check-duplicates", () => {
  describe("extractCardLocations", () => {
    it("extracts all card locations from a single deck", () => {
      const decks = [makeDeck("/deck1.md", [{ itemIndex: 0, cardIds: ["a", "b"] }])]

      const result = extractCardLocations(decks)

      expect(result).toEqual([
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "a" },
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 1, id: "b" },
      ])
    })

    it("extracts locations from multiple decks", () => {
      const decks = [
        makeDeck("/deck1.md", [{ itemIndex: 0, cardIds: ["a"] }]),
        makeDeck("/deck2.md", [{ itemIndex: 0, cardIds: ["b"] }]),
      ]

      const result = extractCardLocations(decks)

      expect(result).toEqual([
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "a" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "b" },
      ])
    })

    it("extracts locations from multiple items in a deck", () => {
      const decks = [
        makeDeck("/deck1.md", [
          { itemIndex: 0, cardIds: ["a"] },
          { itemIndex: 1, cardIds: ["b"] },
        ]),
      ]

      const result = extractCardLocations(decks)

      expect(result).toEqual([
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "a" },
        { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "b" },
      ])
    })

    it("returns empty array for empty decks", () => {
      const result = extractCardLocations([])
      expect(result).toEqual([])
    })

    it("returns empty array for deck with no items", () => {
      const decks = [makeDeck("/deck1.md", [])]
      const result = extractCardLocations(decks)
      expect(result).toEqual([])
    })
  })

  describe("findDuplicates", () => {
    it("finds duplicates across different files", () => {
      const locations: CardLocation[] = [
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "def" },
      ]

      const result = findDuplicates(locations)

      expect(result).toEqual({
        abc: [
          { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
          { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        ],
      })
    })

    it("finds duplicates within same file", () => {
      const locations: CardLocation[] = [
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        { filePath: "/deck1.md", itemIndex: 2, cardIndex: 0, id: "abc" },
      ]

      const result = findDuplicates(locations)

      expect(result).toEqual({
        abc: [
          { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
          { filePath: "/deck1.md", itemIndex: 2, cardIndex: 0, id: "abc" },
        ],
      })
    })

    it("finds multiple duplicate IDs", () => {
      const locations: CardLocation[] = [
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "def" },
        { filePath: "/deck3.md", itemIndex: 0, cardIndex: 0, id: "def" },
      ]

      const result = findDuplicates(locations)

      expect(Object.keys(result)).toHaveLength(2)
      expect(result["abc"]).toHaveLength(2)
      expect(result["def"]).toHaveLength(2)
    })

    it("returns empty record when no duplicates", () => {
      const locations: CardLocation[] = [
        { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "a" },
        { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "b" },
        { filePath: "/deck3.md", itemIndex: 0, cardIndex: 0, id: "c" },
      ]

      const result = findDuplicates(locations)

      expect(result).toEqual({})
    })

    it("returns empty record for empty input", () => {
      const result = findDuplicates([])
      expect(result).toEqual({})
    })
  })

  describe("formatDuplicates", () => {
    it("formats single duplicate", () => {
      const duplicates = {
        abc: [
          { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
          { filePath: "/deck2.md", itemIndex: 1, cardIndex: 0, id: "abc" },
        ],
      }

      const result = formatDuplicates(duplicates)

      expect(result).toContain("Duplicate ID: abc")
      expect(result).toContain("/deck1.md (item 0, card 0)")
      expect(result).toContain("/deck2.md (item 1, card 0)")
      expect(result).toContain("Found 1 duplicate ID(s)")
    })

    it("formats multiple duplicates", () => {
      const duplicates = {
        abc: [
          { filePath: "/deck1.md", itemIndex: 0, cardIndex: 0, id: "abc" },
          { filePath: "/deck2.md", itemIndex: 0, cardIndex: 0, id: "abc" },
        ],
        def: [
          { filePath: "/deck1.md", itemIndex: 1, cardIndex: 0, id: "def" },
          { filePath: "/deck3.md", itemIndex: 0, cardIndex: 0, id: "def" },
        ],
      }

      const result = formatDuplicates(duplicates)

      expect(result).toContain("Found 2 duplicate ID(s)")
    })

    it("returns message when no duplicates", () => {
      const result = formatDuplicates({})
      expect(result).toBe("No duplicate IDs found")
    })
  })
})
