import { describe, it, expect } from "vitest"
import { Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform"
import { SystemError } from "@effect/platform/Error"
import {
  DeckWriter,
  DeckWriterLive,
  DeckWriteError,
} from "../../src/services/DeckWriter"
import { State, numericField, generateId } from "@re/core"
import type { ItemMetadata, ItemId } from "@re/core"

const validDeckContent = `---
title: Test
---

<!--@ abc123 5 4.5 2 0 2025-01-01T00:00:00Z-->
Question 1
---
Answer 1

<!--@ def456 0 0 0 0-->
Question 2
---
Answer 2
`

const duplicateDeckContent = `---
title: Duplicates
---

<!--@ id1 1 5 0 0-->
Same question
---
Same answer

<!--@ id2 1 5 0 0-->
Same question
---
Same answer
`

const makeCard = (
  id: string,
  state: number,
  stability: number,
  lastReview: Date | null
): ItemMetadata => ({
  id: id as ItemId,
  stability: numericField(stability),
  difficulty: numericField(5),
  state: state as 0 | 1 | 2 | 3,
  learningSteps: 0,
  lastReview,
})

describe("DeckWriter", () => {
  describe("updateCard", () => {
    it("updates card at specified index", async () => {
      let writtenContent = ""

      const MockFS = FileSystem.layerNoop({
        readFileString: (path) => {
          if (path === "/test.md") return Effect.succeed(validDeckContent)
          return Effect.fail(
            new SystemError({
              reason: "NotFound",
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: path,
            })
          )
        },
        writeFileString: (_path, content) => {
          writtenContent = content
          return Effect.succeed(void 0)
        },
      })

      const TestLayer = DeckWriterLive.pipe(Layer.provide(MockFS))

      const newCard = makeCard("abc123", State.Review, 10, new Date())

      await Effect.gen(function* () {
        const writer = yield* DeckWriter
        yield* writer.updateCard("/test.md", 0, 0, newCard)
      }).pipe(Effect.provide(TestLayer), Effect.runPromise)

      // Verify the file was written
      expect(writtenContent).toContain("<!--@ abc123")
      expect(writtenContent).toContain("10") // new stability
    })

    it("updates correct item when multiple items have same content", async () => {
      let writtenContent = ""

      const MockFS = FileSystem.layerNoop({
        readFileString: (path) => {
          if (path === "/duplicates.md")
            return Effect.succeed(duplicateDeckContent)
          return Effect.fail(
            new SystemError({
              reason: "NotFound",
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: path,
            })
          )
        },
        writeFileString: (_path, content) => {
          writtenContent = content
          return Effect.succeed(void 0)
        },
      })

      const TestLayer = DeckWriterLive.pipe(Layer.provide(MockFS))

      // Update the SECOND item (itemIndex: 1)
      const newCard = makeCard("id2", State.Review, 10, new Date())

      await Effect.gen(function* () {
        const writer = yield* DeckWriter
        yield* writer.updateCard("/duplicates.md", 1, 0, newCard)
      }).pipe(Effect.provide(TestLayer), Effect.runPromise)

      // The file should have both items, but only the second one updated
      // First item should still have stability 1
      const lines = writtenContent.split("\n")
      const metadataLines = lines.filter((l) => l.startsWith("<!--@"))

      expect(metadataLines.length).toBe(2)
      // First metadata should have stability 1
      expect(metadataLines[0]).toContain("id1")
      expect(metadataLines[0]).toMatch(/<!--@ id1 1 5/)
      // Second metadata should have stability 10
      expect(metadataLines[1]).toContain("id2")
      expect(metadataLines[1]).toMatch(/<!--@ id2 10 5/)
    })

    it("fails with out-of-bounds item index", async () => {
      const MockFS = FileSystem.layerNoop({
        readFileString: () => Effect.succeed(validDeckContent),
        writeFileString: () => Effect.succeed(void 0),
      })

      const TestLayer = DeckWriterLive.pipe(Layer.provide(MockFS))

      const newCard = makeCard("test", State.New, 0, null)

      const result = await Effect.gen(function* () {
        const writer = yield* DeckWriter
        return yield* writer.updateCard("/test.md", 999, 0, newCard).pipe(
          Effect.either
        )
      }).pipe(Effect.provide(TestLayer), Effect.runPromise)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(DeckWriteError)
        expect(result.left.message).toContain("out of bounds")
      }
    })

    it("fails with out-of-bounds card index", async () => {
      const MockFS = FileSystem.layerNoop({
        readFileString: () => Effect.succeed(validDeckContent),
        writeFileString: () => Effect.succeed(void 0),
      })

      const TestLayer = DeckWriterLive.pipe(Layer.provide(MockFS))

      const newCard = makeCard("test", State.New, 0, null)

      const result = await Effect.gen(function* () {
        const writer = yield* DeckWriter
        return yield* writer.updateCard("/test.md", 0, 999, newCard).pipe(
          Effect.either
        )
      }).pipe(Effect.provide(TestLayer), Effect.runPromise)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(DeckWriteError)
        expect(result.left.message).toContain("out of bounds")
      }
    })

    it("fails when file doesn't exist", async () => {
      const MockFS = FileSystem.layerNoop({
        readFileString: (path) =>
          Effect.fail(
            new SystemError({
              reason: "NotFound",
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: path,
            })
          ),
        writeFileString: () => Effect.succeed(void 0),
      })

      const TestLayer = DeckWriterLive.pipe(Layer.provide(MockFS))

      const newCard = makeCard("test", State.New, 0, null)

      const result = await Effect.gen(function* () {
        const writer = yield* DeckWriter
        return yield* writer.updateCard("/missing.md", 0, 0, newCard).pipe(
          Effect.either
        )
      }).pipe(Effect.provide(TestLayer), Effect.runPromise)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(DeckWriteError)
        expect(result.left.message).toContain("Filesystem error")
      }
    })
  })
})
