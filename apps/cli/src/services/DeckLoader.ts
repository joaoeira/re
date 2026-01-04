import { Context, Effect, Layer } from "effect";
import { Scheduler } from "./Scheduler";
import { DeckParser } from "./DeckParser";
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
    const parser = yield* DeckParser;
    const scheduler = yield* Scheduler;

    const loadSingleDeck = (
      filePath: string,
      now: Date
    ): Effect.Effect<DeckStats, never> =>
      Effect.gen(function* () {
        const parseResult = yield* parser.parse(filePath).pipe(Effect.either);

        if (parseResult._tag === "Left") {
          const error = parseResult.left;
          return {
            path: filePath,
            name: filePath.split("/").pop()?.replace(".md", "") ?? "",
            totalCards: 0,
            newCards: 0,
            dueCards: 0,
            isEmpty: true,
            parseError: error.message,
          };
        }

        const { name, file } = parseResult.right;
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
          { concurrency: "unbounded" }
        ),
    };
  })
);
