import { FileSystem, Path } from "@effect/platform";
import { Schema } from "@effect/schema";
import {
  parseFile,
  serializeFile,
  type ContentParseError,
  type ItemMetadata,
  type ItemType,
  type ParsedFile,
} from "@re/core";
import { Context, Effect, Layer } from "effect";

import { formatMetadataParseError } from "./snapshotWorkspace";

export class DeckNotFound extends Schema.TaggedError<DeckNotFound>("@re/workspace/DeckNotFound")(
  "DeckNotFound",
  {
    deckPath: Schema.String,
  },
) {}

export class DeckReadError extends Schema.TaggedError<DeckReadError>("@re/workspace/DeckReadError")(
  "DeckReadError",
  {
    deckPath: Schema.String,
    message: Schema.String,
  },
) {}

export class DeckParseError extends Schema.TaggedError<DeckParseError>(
  "@re/workspace/DeckParseError",
)("DeckParseError", {
  deckPath: Schema.String,
  message: Schema.String,
}) {}

export class DeckWriteError extends Schema.TaggedError<DeckWriteError>(
  "@re/workspace/DeckWriteError",
)("DeckWriteError", {
  deckPath: Schema.String,
  message: Schema.String,
}) {}

export class CardNotFound extends Schema.TaggedError<CardNotFound>("@re/workspace/CardNotFound")(
  "CardNotFound",
  {
    deckPath: Schema.String,
    cardId: Schema.String,
  },
) {}

export class ItemValidationError extends Schema.TaggedError<ItemValidationError>(
  "@re/workspace/ItemValidationError",
)("ItemValidationError", {
  deckPath: Schema.String,
  message: Schema.String,
}) {}

export type ReadError = DeckNotFound | DeckReadError | DeckParseError;
export type WriteError = ReadError | DeckWriteError;

export interface DeckManager {
  readonly readDeck: (deckPath: string) => Effect.Effect<ParsedFile, ReadError>;

  readonly updateCardMetadata: (
    deckPath: string,
    cardId: string,
    metadata: ItemMetadata,
  ) => Effect.Effect<void, WriteError | CardNotFound>;

  readonly replaceItem: (
    deckPath: string,
    cardId: string,
    newItem: { readonly cards: readonly ItemMetadata[]; readonly content: string },
    itemType: ItemType<any, any, any>,
  ) => Effect.Effect<void, WriteError | CardNotFound | ItemValidationError>;

  readonly appendItem: (
    deckPath: string,
    item: { readonly cards: readonly ItemMetadata[]; readonly content: string },
    itemType: ItemType<any, any, any>,
  ) => Effect.Effect<void, WriteError | ItemValidationError>;

  readonly removeItem: (
    deckPath: string,
    cardId: string,
  ) => Effect.Effect<void, WriteError | CardNotFound>;
}

export const DeckManager = Context.GenericTag<DeckManager>("@re/workspace/DeckManager");

export const DeckManagerLive: Layer.Layer<DeckManager, never, FileSystem.FileSystem | Path.Path> =
  Layer.effect(
    DeckManager,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const readAndParse = (deckPath: string): Effect.Effect<ParsedFile, ReadError> =>
        fs.readFileString(deckPath).pipe(
          Effect.mapError((error): ReadError => {
            if (error._tag === "SystemError" && error.reason === "NotFound") {
              return new DeckNotFound({ deckPath });
            }
            return new DeckReadError({ deckPath, message: error.message });
          }),
          Effect.flatMap((content) =>
            parseFile(content).pipe(
              Effect.mapError(
                (error) =>
                  new DeckParseError({ deckPath, message: formatMetadataParseError(error) }),
              ),
            ),
          ),
        );

      const findItemByCardId = (
        parsed: ParsedFile,
        cardId: string,
        deckPath: string,
      ): Effect.Effect<{ itemIndex: number; cardIndex: number }, CardNotFound> => {
        for (let i = 0; i < parsed.items.length; i++) {
          const item = parsed.items[i]!;
          for (let c = 0; c < item.cards.length; c++) {
            if (item.cards[c]!.id === cardId) {
              return Effect.succeed({ itemIndex: i, cardIndex: c });
            }
          }
        }
        return Effect.fail(new CardNotFound({ deckPath, cardId }));
      };

      const atomicWrite = (
        deckPath: string,
        content: string,
      ): Effect.Effect<void, DeckWriteError> => {
        const tmpPath = `${deckPath}.tmp`;
        return fs.writeFileString(tmpPath, content).pipe(
          Effect.flatMap(() => fs.rename(tmpPath, deckPath)),
          Effect.catchAll((error) =>
            fs.remove(tmpPath).pipe(
              Effect.ignore,
              Effect.flatMap(() =>
                Effect.fail(new DeckWriteError({ deckPath, message: String(error) })),
              ),
            ),
          ),
        );
      };

      const validateItemCardCount = (
        item: { readonly cards: readonly ItemMetadata[]; readonly content: string },
        itemType: ItemType<any, any, any>,
        deckPath: string,
      ): Effect.Effect<void, ItemValidationError> =>
        (itemType.parse(item.content) as Effect.Effect<unknown, ContentParseError>).pipe(
          Effect.mapError(
            (error) =>
              new ItemValidationError({
                deckPath,
                message: `Content parse failed for type "${itemType.name}": ${error.message}`,
              }),
          ),
          Effect.flatMap((parsed) => {
            const expectedCards = itemType.cards(parsed).length;
            if (expectedCards !== item.cards.length) {
              return Effect.fail(
                new ItemValidationError({
                  deckPath,
                  message: `Card count mismatch: content produces ${expectedCards} card(s) but item has ${item.cards.length}`,
                }),
              );
            }
            return Effect.void;
          }),
        );

      return DeckManager.of({
        readDeck: readAndParse,

        updateCardMetadata: (deckPath, cardId, metadata) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            const { itemIndex, cardIndex } = yield* findItemByCardId(parsed, cardId, deckPath);

            const updatedItems = parsed.items.map((item, idx) => {
              if (idx !== itemIndex) return item;
              const updatedCards = item.cards.map((card, cIdx) =>
                cIdx === cardIndex ? metadata : card,
              );
              return { ...item, cards: updatedCards };
            });

            const serialized = serializeFile({ ...parsed, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),

        replaceItem: (deckPath, cardId, newItem, itemType) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            const { itemIndex } = yield* findItemByCardId(parsed, cardId, deckPath);
            yield* validateItemCardCount(newItem, itemType, deckPath);

            const updatedItems = parsed.items.map((item, idx) =>
              idx === itemIndex ? newItem : item,
            );

            const serialized = serializeFile({ ...parsed, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),

        appendItem: (deckPath, item, itemType) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            yield* validateItemCardCount(item, itemType, deckPath);

            let { preamble, items } = parsed;

            if (items.length > 0) {
              const lastItem = items[items.length - 1]!;
              if (lastItem.content.length > 0 && !lastItem.content.endsWith("\n")) {
                const fixedItems = [...items];
                fixedItems[fixedItems.length - 1] = {
                  ...lastItem,
                  content: lastItem.content + "\n",
                };
                items = fixedItems;
              }
            } else if (preamble.length > 0 && !preamble.endsWith("\n")) {
              preamble = preamble + "\n";
            }

            const updatedItems = [...items, item];
            const serialized = serializeFile({ preamble, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),

        removeItem: (deckPath, cardId) =>
          Effect.gen(function* () {
            const parsed = yield* readAndParse(deckPath);
            const { itemIndex } = yield* findItemByCardId(parsed, cardId, deckPath);

            const updatedItems = parsed.items.filter((_, idx) => idx !== itemIndex);
            const serialized = serializeFile({ ...parsed, items: updatedItems });
            yield* atomicWrite(deckPath, serialized);
          }),
      });
    }),
  );
