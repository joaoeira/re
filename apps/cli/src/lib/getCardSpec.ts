import { Effect } from "effect";
import { adaptItemType, inferCards, type EvaluableCardSpec } from "@re/core";
import { QAType, ClozeType } from "@re/item-types";
import type { QueueItem } from "@re/workspace";

const itemTypes = [adaptItemType(QAType), adaptItemType(ClozeType)];

export class CardSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardSpecError";
  }
}

export const getCardSpec = (
  queueItem: QueueItem,
): Effect.Effect<EvaluableCardSpec, CardSpecError> =>
  Effect.gen(function* () {
    const { cards } = yield* inferCards(itemTypes, queueItem.item.content).pipe(
      Effect.mapError((e) => new CardSpecError(`Failed to parse item: ${e._tag}: ${e.message}`)),
    );

    const cardSpec = cards[queueItem.cardIndex];

    if (!cardSpec) {
      return yield* Effect.fail(
        new CardSpecError(
          `Card index ${queueItem.cardIndex} out of bounds (${cards.length} cards)`,
        ),
      );
    }

    return cardSpec;
  });
