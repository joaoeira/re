import { Context, Effect, Layer, Data } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { parseFile, type ParsedFile } from "@re/core";

export class DeckReadError extends Data.TaggedError("DeckReadError")<{
  readonly path: string;
  readonly message: string;
}> {}

export class DeckParseError extends Data.TaggedError("DeckParseError")<{
  readonly path: string;
  readonly message: string;
}> {}

export type DeckParserError = DeckReadError | DeckParseError;

export interface ParsedDeck {
  readonly path: string;
  readonly name: string;
  readonly file: ParsedFile;
}

export interface DeckParser {
  readonly parse: (deckPath: string) => Effect.Effect<ParsedDeck, DeckParserError>;

  readonly parseAll: (deckPaths: readonly string[]) => Effect.Effect<ParsedDeck[], never>;
}

export const DeckParser = Context.GenericTag<DeckParser>("DeckParser");

export const DeckParserLive = Layer.effect(
  DeckParser,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const parseSingle = (deckPath: string): Effect.Effect<ParsedDeck, DeckParserError> =>
      Effect.gen(function* () {
        const name = path.basename(deckPath, ".md");

        const content = yield* fs
          .readFileString(deckPath)
          .pipe(
            Effect.mapError(() => new DeckReadError({ path: deckPath, message: "Read error" })),
          );

        const file = yield* parseFile(content).pipe(
          Effect.mapError(
            (e) =>
              new DeckParseError({
                path: deckPath,
                message: `Parse error: ${e._tag}`,
              }),
          ),
        );

        return { path: deckPath, name, file };
      });

    return {
      parse: parseSingle,

      parseAll: (deckPaths) =>
        Effect.all(
          deckPaths.map((p) => parseSingle(p).pipe(Effect.either)),
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map((results) => results.filter((r) => r._tag === "Right").map((r) => r.right)),
        ),
    };
  }),
);
