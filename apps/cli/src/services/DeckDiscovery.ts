import { Context, Effect, Layer, Either } from "effect"
import { FileSystem } from "@effect/platform"
import * as nodePath from "node:path"

export interface DiscoveryResult {
  readonly paths: string[]
  readonly error: string | null // null = success, string = error message
}

export interface DeckDiscovery {
  readonly discoverDecks: (
    rootPath: string
  ) => Effect.Effect<DiscoveryResult, never>
}

export const DeckDiscovery = Context.GenericTag<DeckDiscovery>("DeckDiscovery")

export const DeckDiscoveryLive = Layer.effect(
  DeckDiscovery,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    return {
      discoverDecks: (rootPath) =>
        Effect.gen(function* () {
          const entriesResult = yield* fs
            .readDirectory(rootPath, { recursive: true })
            .pipe(Effect.either)

          if (Either.isLeft(entriesResult)) {
            return {
              paths: [],
              error: `Failed to read directory: ${entriesResult.left.message}`,
            }
          }

          const entries = entriesResult.right

          // Filter for .md files, excluding those in hidden directories
          // Use "/" for splitting since readDirectory returns normalized paths
          const paths = entries
            .filter((entry) => {
              if (!entry.endsWith(".md")) return false
              const segments = entry.split("/")
              return !segments.slice(0, -1).some((seg) => seg.startsWith("."))
            })
            .map((entry) => nodePath.join(rootPath, entry))

          return { paths, error: null }
        }).pipe(Effect.provideService(FileSystem.FileSystem, fs)),
    }
  })
)
