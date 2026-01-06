import { Context, Effect, Layer, Data } from "effect"
import { FileSystem } from "@effect/platform"
import {
  parseFile,
  serializeFile,
  type ItemMetadata,
  type ParsedFile,
} from "@re/core"

export interface DeckWriter {
  readonly updateCard: (
    deckPath: string,
    itemIndex: number, // Index within ParsedFile.items (stable identifier)
    cardIndex: number, // Index within item.cards
    newCard: ItemMetadata
  ) => Effect.Effect<void, DeckWriteError>
}

export class DeckWriteError extends Data.TaggedError("DeckWriteError")<{
  readonly path: string
  readonly message: string
}> {}

export const DeckWriter = Context.GenericTag<DeckWriter>("DeckWriter")

const mapFsError =
  (path: string) =>
  (error: unknown): DeckWriteError =>
    new DeckWriteError({ path, message: `Filesystem error: ${String(error)}` })

export const DeckWriterLive = Layer.effect(
  DeckWriter,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    return {
      updateCard: (deckPath, itemIndex, cardIndex, newCard) =>
        Effect.gen(function* () {
          const content = yield* fs
            .readFileString(deckPath)
            .pipe(Effect.mapError(mapFsError(deckPath)))

          const parsed = yield* parseFile(content).pipe(
            Effect.mapError(
              (e) =>
                new DeckWriteError({
                  path: deckPath,
                  message: `Parse error: ${String(e)}`,
                })
            )
          )

          if (itemIndex < 0 || itemIndex >= parsed.items.length) {
            return yield* Effect.fail(
              new DeckWriteError({
                path: deckPath,
                message: `Item index ${itemIndex} out of bounds (${parsed.items.length} items)`,
              })
            )
          }

          const item = parsed.items[itemIndex]!
          if (cardIndex < 0 || cardIndex >= item.cards.length) {
            return yield* Effect.fail(
              new DeckWriteError({
                path: deckPath,
                message: `Card index ${cardIndex} out of bounds (${item.cards.length} cards)`,
              })
            )
          }

          const updatedItems = parsed.items.map((item, idx) => {
            if (idx !== itemIndex) return item

            const updatedCards = item.cards.map((card, cIdx) =>
              cIdx === cardIndex ? newCard : card
            )

            return { ...item, cards: updatedCards }
          })

          const updatedFile: ParsedFile = {
            ...parsed,
            items: updatedItems,
          }

          const serialized = serializeFile(updatedFile)
          yield* fs
            .writeFileString(deckPath, serialized)
            .pipe(Effect.mapError(mapFsError(deckPath)))
        }),
    }
  })
)
