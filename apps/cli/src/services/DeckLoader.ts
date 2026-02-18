import { Context, Effect, Layer } from "effect";
import { Path } from "@effect/platform";
import { DeckManager } from "@re/workspace";
import { Scheduler } from "./Scheduler";
import { State } from "@re/core";

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
  readonly loadDeck: (filePath: string, now: Date) => Effect.Effect<DeckStats, never>;
  readonly loadAllDecks: (paths: string[], now: Date) => Effect.Effect<DeckStats[], never>;
}

export const DeckLoader = Context.GenericTag<DeckLoader>("DeckLoader");

export const DeckLoaderLive = Layer.effect(
  DeckLoader,
  Effect.gen(function* () {
    const deckManager = yield* DeckManager;
    const scheduler = yield* Scheduler;
    const pathService = yield* Path.Path;

    const loadSingleDeck = (filePath: string, now: Date): Effect.Effect<DeckStats, never> =>
      Effect.gen(function* () {
        const name = pathService.basename(filePath, ".md");
        const readResult = yield* deckManager.readDeck(filePath).pipe(Effect.either);

        if (readResult._tag === "Left") {
          const error = readResult.left;
          return {
            path: filePath,
            name,
            totalCards: 0,
            newCards: 0,
            dueCards: 0,
            isEmpty: true,
            parseError: error._tag === "DeckNotFound" ? "Deck not found" : error.message,
          };
        }

        const file = readResult.right;
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
      });

    return {
      loadDeck: loadSingleDeck,
      loadAllDecks: (paths, now) =>
        Effect.all(
          paths.map((p) => loadSingleDeck(p, now)),
          { concurrency: "unbounded" },
        ),
    };
  }),
);
