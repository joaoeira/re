import { Context, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { Scheduler } from "./Scheduler";
import { parseFile, State } from "@re/core";
import * as nodePath from "node:path";

export interface DeckStats {
  readonly path: string;
  readonly name: string;
  readonly totalCards: number;
  readonly newCards: number;
  readonly dueCards: number;
  readonly isEmpty: boolean;
  readonly parseError: string | null;
}

export interface DeckLoader {
  readonly loadDeck: (
    filePath: string,
    now: Date
  ) => Effect.Effect<DeckStats, never>;
  readonly loadAllDecks: (
    paths: string[],
    now: Date
  ) => Effect.Effect<DeckStats[], never>;
}

export const DeckLoader = Context.GenericTag<DeckLoader>("DeckLoader");

export const DeckLoaderLive = Layer.effect(
  DeckLoader,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const scheduler = yield* Scheduler;

    const loadSingleDeck = (
      filePath: string,
      now: Date
    ): Effect.Effect<DeckStats, never> =>
      Effect.gen(function* () {
        const name = nodePath.basename(filePath, ".md");

        // Try to read file
        const contentResult = yield* fs
          .readFileString(filePath)
          .pipe(Effect.either);
        if (contentResult._tag === "Left") {
          return {
            path: filePath,
            name,
            totalCards: 0,
            newCards: 0,
            dueCards: 0,
            isEmpty: true,
            parseError: "Read error",
          };
        }

        // Try to parse
        const parseResult = yield* parseFile(contentResult.right).pipe(
          Effect.either
        );
        if (parseResult._tag === "Left") {
          return {
            path: filePath,
            name,
            totalCards: 0,
            newCards: 0,
            dueCards: 0,
            isEmpty: true,
            parseError: `Parse error: ${parseResult.left._tag}`,
          };
        }

        const file = parseResult.right;
        let totalCards = 0;
        let newCards = 0;
        let dueCards = 0;

        for (const item of file.items) {
          for (const card of item.cards) {
            totalCards++;
            if (card.state === State.New) {
              newCards++;
            } else if (scheduler.isDue(card, now)) {
              dueCards++;
            }
          }
        }

        return {
          path: filePath,
          name,
          totalCards,
          newCards,
          dueCards,
          isEmpty: totalCards === 0,
          parseError: null,
        };
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));

    return {
      loadDeck: loadSingleDeck,
      loadAllDecks: (paths, now) =>
        Effect.all(
          paths.map((p) => loadSingleDeck(p, now)),
          { concurrency: "unbounded" }
        ),
    };
  })
);
