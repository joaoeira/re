import { FileSystem, Path } from "@effect/platform";
import { Schema } from "@effect/schema";
import { parseFile, State, type MetadataParseError, type ParsedFile } from "@re/core";
import { Effect } from "effect";

import {
  scanDecks,
  ScanDecksErrorSchema,
  type DeckEntry,
  type ScanDecksError,
  type ScanDecksOptions,
} from "./scanDecks";

export const DeckStateCountsSchema = Schema.Struct({
  new: Schema.Number,
  learning: Schema.Number,
  review: Schema.Number,
  relearning: Schema.Number,
});

export type DeckStateCounts = typeof DeckStateCountsSchema.Type;

const DeckSnapshotBaseFields = {
  absolutePath: Schema.String,
  relativePath: Schema.String,
  name: Schema.String,
} as const;

export const DeckSnapshotOkSchema = Schema.Struct({
  ...DeckSnapshotBaseFields,
  status: Schema.Literal("ok"),
  totalCards: Schema.Number,
  stateCounts: DeckStateCountsSchema,
});

export const DeckSnapshotReadErrorSchema = Schema.Struct({
  ...DeckSnapshotBaseFields,
  status: Schema.Literal("read_error"),
  message: Schema.String,
});

export const DeckSnapshotParseErrorSchema = Schema.Struct({
  ...DeckSnapshotBaseFields,
  status: Schema.Literal("parse_error"),
  message: Schema.String,
});

export const DeckSnapshotSchema = Schema.Union(
  DeckSnapshotOkSchema,
  DeckSnapshotReadErrorSchema,
  DeckSnapshotParseErrorSchema,
);

export type DeckSnapshot = typeof DeckSnapshotSchema.Type;

export const SnapshotWorkspaceResultSchema = Schema.Struct({
  rootPath: Schema.String,
  decks: Schema.Array(DeckSnapshotSchema),
});

export type SnapshotWorkspaceResult = typeof SnapshotWorkspaceResultSchema.Type;

export const SnapshotWorkspaceErrorSchema = ScanDecksErrorSchema;

export type SnapshotWorkspaceError = ScanDecksError;

type DeckStateCountKey = keyof DeckStateCounts;
type MutableDeckStateCounts = Record<DeckStateCountKey, number>;

const STATE_TO_COUNT_KEY: Record<State, DeckStateCountKey> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const emptyDeckStateCounts = (): MutableDeckStateCounts => ({
  new: 0,
  learning: 0,
  review: 0,
  relearning: 0,
});

const incrementDeckStateCount = (
  stateCounts: MutableDeckStateCounts,
  state: State,
): void => {
  const key = STATE_TO_COUNT_KEY[state];
  stateCounts[key] += 1;
};

const summarizeParsedDeck = (
  parsedFile: ParsedFile,
): {
  totalCards: number;
  stateCounts: DeckStateCounts;
} => {
  const stateCounts = emptyDeckStateCounts();
  let totalCards = 0;

  for (const item of parsedFile.items) {
    for (const card of item.cards) {
      totalCards += 1;
      incrementDeckStateCount(stateCounts, card.state);
    }
  }

  return {
    totalCards,
    stateCounts: {
      new: stateCounts.new,
      learning: stateCounts.learning,
      review: stateCounts.review,
      relearning: stateCounts.relearning,
    },
  };
};

const toReadErrorMessage = (error: { readonly message: string }): string =>
  error.message;

export const formatMetadataParseError = (error: MetadataParseError): string => {
  switch (error._tag) {
    case "ParseError":
      return `Parse error at line ${error.line}, column ${error.column}: ${error.message}`;
    case "InvalidMetadataFormat":
      return `Invalid metadata at line ${error.line}: ${error.reason}`;
    case "InvalidFieldValue":
      return `Invalid ${error.field} at line ${error.line}: expected ${error.expected}; got "${error.value}"`;
  }
};

const snapshotDeck = (
  deck: DeckEntry,
  fileSystem: FileSystem.FileSystem,
): Effect.Effect<DeckSnapshot, never> =>
  fileSystem.readFileString(deck.absolutePath).pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Effect.succeed({
          ...deck,
          status: "read_error" as const,
          message: toReadErrorMessage(error),
        }),
      onSuccess: (content) =>
        parseFile(content).pipe(
          Effect.match({
            onFailure: (error): DeckSnapshot => ({
              ...deck,
              status: "parse_error",
              message: formatMetadataParseError(error),
            }),
            onSuccess: (parsed): DeckSnapshot => {
              const { totalCards, stateCounts } = summarizeParsedDeck(parsed);
              return {
                ...deck,
                status: "ok",
                totalCards,
                stateCounts,
              };
            },
          }),
        ),
    }),
  );

export const snapshotWorkspace = (
  rootPath: string,
  options?: ScanDecksOptions,
): Effect.Effect<
  SnapshotWorkspaceResult,
  SnapshotWorkspaceError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const scanResult = yield* scanDecks(rootPath, options);

    const deckSnapshots = yield* Effect.forEach(
      scanResult.decks,
      (deck) => snapshotDeck(deck, fileSystem),
      { concurrency: 16 },
    );

    return {
      rootPath: scanResult.rootPath,
      decks: deckSnapshots,
    };
  });
