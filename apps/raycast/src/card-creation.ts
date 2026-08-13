import {
  ContentParseError,
  createMetadata,
  type ItemMetadata,
  type UntypedItemType,
} from "@re/core";
import { ClozeType, QAType } from "@re/types";
import { toScanDecksErrorMessage, type DeckEntry } from "@re/workspace";
import { Data, Effect } from "effect";

import { DeckStore } from "./deck-store";

export type CardType = "qa" | "cloze";
export type CardField = "deckPath" | "question" | "answer" | "content";

export interface CreateCardInput {
  readonly cardType: CardType;
  readonly deckPath: string;
  readonly question: string;
  readonly answer: string;
  readonly content: string;
}

export class CardFieldError extends Data.TaggedError("CardFieldError")<{
  readonly field: CardField;
  readonly message: string;
}> {}

export interface PreparedCard {
  readonly deckPath: string;
  readonly content: string;
  readonly itemType: UntypedItemType;
  readonly item: {
    readonly cards: readonly ItemMetadata[];
    readonly content: string;
  };
  readonly cardCount: number;
}

export type CreateCardUiResult =
  | {
      readonly _tag: "Created";
      readonly cardCount: number;
    }
  | {
      readonly _tag: "FieldError";
      readonly field: CardField;
      readonly message: string;
    }
  | {
      readonly _tag: "OperationError";
      readonly message: string;
    };

export type LoadDecksUiResult =
  | {
      readonly _tag: "DecksLoaded";
      readonly decks: readonly DeckEntry[];
    }
  | {
      readonly _tag: "DecksLoadError";
      readonly message: string;
    };

const QA_SEPARATOR = "\n---\n";

const requireText = (
  value: string,
  field: CardField,
  message: string,
): Effect.Effect<string, CardFieldError> => {
  return value.trim().length === 0
    ? Effect.fail(new CardFieldError({ field, message }))
    : Effect.succeed(value);
};

const formatContentParseError = (error: ContentParseError): string => {
  const fragment = error.fragment === undefined ? "" : ` — ${error.fragment}`;
  return `${error.message}${fragment}`;
};

export const prepareCard = Effect.fn("Raycast.prepareCard")(function* (
  input: CreateCardInput,
) {
  const deckPath = (yield* requireText(
    input.deckPath,
    "deckPath",
    "Choose a deck.",
  )).trim();

  const parsed =
    input.cardType === "qa"
      ? yield* Effect.gen(function* () {
          const question = (yield* requireText(
            input.question,
            "question",
            "Enter a question.",
          )).trim();
          const answer = (yield* requireText(
            input.answer,
            "answer",
            "Enter an answer.",
          )).trim();
          if (question.includes(QA_SEPARATOR)) {
            return yield* new CardFieldError({
              field: "question",
              message:
                "A question cannot contain a line consisting only of ---.",
            });
          }
          const content = `${question}${QA_SEPARATOR}${answer}`;
          const parsedContent = yield* QAType.parse(content);
          return {
            content,
            itemType: QAType as UntypedItemType,
            cardCount: QAType.cards(parsedContent).length,
          };
        })
      : yield* Effect.gen(function* () {
          const content = yield* requireText(
            input.content,
            "content",
            "Enter cloze content.",
          );
          const parsedContent = yield* ClozeType.parse(content);
          return {
            content,
            itemType: ClozeType as UntypedItemType,
            cardCount: ClozeType.cards(parsedContent).length,
          };
        });

  const cards = Array.from({ length: parsed.cardCount }, () =>
    createMetadata(),
  );

  return {
    deckPath,
    content: parsed.content,
    itemType: parsed.itemType,
    item: {
      cards,
      content: parsed.content,
    },
    cardCount: parsed.cardCount,
  } satisfies PreparedCard;
});

export const createCard = Effect.fn("Raycast.createCard")(function* (
  input: CreateCardInput,
) {
  const prepared = yield* prepareCard(input);
  const store = yield* DeckStore;
  yield* store.appendItem(prepared.deckPath, prepared.item, prepared.itemType);
  return { cardCount: prepared.cardCount } as const;
});

const operationError = (message: string): CreateCardUiResult => ({
  _tag: "OperationError",
  message,
});

export const createCardForUi = (
  input: CreateCardInput,
): Effect.Effect<CreateCardUiResult, never, DeckStore> =>
  createCard(input).pipe(
    Effect.map(
      ({ cardCount }): CreateCardUiResult => ({
        _tag: "Created",
        cardCount,
      }),
    ),
    Effect.catchTags({
      CardFieldError: (error) =>
        Effect.succeed<CreateCardUiResult>({
          _tag: "FieldError",
          field: error.field,
          message: error.message,
        }),
      ContentParseError: (error) =>
        Effect.succeed<CreateCardUiResult>({
          _tag: "FieldError",
          field: input.cardType === "cloze" ? "content" : "question",
          message: formatContentParseError(error),
        }),
      DeckNotFound: () =>
        Effect.succeed<CreateCardUiResult>({
          _tag: "FieldError",
          field: "deckPath",
          message: "The selected deck no longer exists. Refresh the deck list.",
        }),
      DeckParseError: (error) =>
        Effect.succeed<CreateCardUiResult>({
          _tag: "FieldError",
          field: "deckPath",
          message: `The selected deck is invalid: ${error.message}`,
        }),
      DeckReadError: (error) =>
        Effect.succeed(
          operationError(`Could not read the selected deck: ${error.message}`),
        ),
      DeckWriteError: (error) =>
        Effect.succeed(
          operationError(`Could not write the selected deck: ${error.message}`),
        ),
      ItemValidationError: (error) =>
        Effect.succeed(operationError(error.message)),
    }),
  );

export const loadDecksForUi = (
  workspacePath: string,
): Effect.Effect<LoadDecksUiResult, never, DeckStore> =>
  DeckStore.pipe(
    Effect.flatMap((store) => store.listDecks(workspacePath)),
    Effect.map(
      (decks): LoadDecksUiResult => ({
        _tag: "DecksLoaded",
        decks,
      }),
    ),
    Effect.catchAll((error) =>
      Effect.succeed<LoadDecksUiResult>({
        _tag: "DecksLoadError",
        message: toScanDecksErrorMessage(error),
      }),
    ),
  );
