import { Effect } from "effect";
import { inferType, type CardSpec, type Grade, type ItemType } from "@re/core";
import { QAType, ClozeType } from "@re/types";
import type { QueueItem } from "@re/workspace";

const itemTypes = [QAType, ClozeType] as ReadonlyArray<ItemType<unknown, unknown, unknown>>;

export class CardSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardSpecError";
  }
}

export const getCardSpec = (queueItem: QueueItem): Effect.Effect<CardSpec<Grade>, CardSpecError> =>
  Effect.gen(function* () {
    const result = yield* inferType(itemTypes, queueItem.item.content).pipe(
      Effect.mapError((e) => new CardSpecError(`Failed to parse item: ${e._tag}: ${e.message}`)),
    );

    const cards = result.type.cards(result.content);
    const cardSpec = cards[queueItem.cardIndex];

    if (!cardSpec) {
      return yield* Effect.fail(
        new CardSpecError(
          `Card index ${queueItem.cardIndex} out of bounds (${cards.length} cards)`,
        ),
      );
    }

    return cardSpec as CardSpec<Grade>;
  });
