import { Data, Effect, Either } from "effect";
import {
  adaptItemType,
  matchItemTypes,
  type Item,
  type ItemMetadata,
  type EvaluableCardSpec,
  type ItemTypeMatch,
  type ItemCardCountMismatch,
  type NoMatchingTypeError,
} from "@simbyotic/re-core";
import { ClozeType } from "./cloze.js";
import { QAType } from "./qa.js";

// This order also controls the repair fallback in ItemCardCountMismatch.
// A count-matching cloze interpretation wins over a count-matching Q&A one.
const builtinTypes = [adaptItemType(ClozeType), adaptItemType(QAType)] as const;

export const resolveBuiltinItem = (
  item: Item,
): Effect.Effect<ItemTypeMatch, NoMatchingTypeError | ItemCardCountMismatch> =>
  matchItemTypes(builtinTypes, item).pipe(Effect.map((matches) => matches[0]));

export class BuiltinCardNotFound extends Data.TaggedError("BuiltinCardNotFound")<{
  readonly cardId: string;
  readonly cardKey: string | null;
}> {
  override get message(): string {
    return `Card ${this.cardId} no longer matches the requested key ${this.cardKey ?? "(unresolved)"}.`;
  }
}

export interface AnnotatedBuiltinCards<Entry> {
  readonly items: readonly (Entry & { readonly cardKey: string })[];
  readonly errors: readonly {
    readonly entry: Entry;
    readonly error: NoMatchingTypeError | ItemCardCountMismatch | BuiltinCardNotFound;
  }[];
}

/** Keep resolvable cards in queue order and report each invalid item once. */
export const annotateBuiltinCardKeys = <
  Entry extends { readonly item: Item; readonly card: Pick<ItemMetadata, "id"> },
>(
  entries: readonly Entry[],
): Effect.Effect<AnnotatedBuiltinCards<Entry>> =>
  Effect.gen(function* () {
    const keysByItem = new Map<
      Item,
      Either.Either<ReadonlyMap<string, string>, NoMatchingTypeError | ItemCardCountMismatch>
    >();
    const items: Array<Entry & { readonly cardKey: string }> = [];
    const errors: Array<AnnotatedBuiltinCards<Entry>["errors"][number]> = [];

    for (const entry of entries) {
      let result = keysByItem.get(entry.item);
      if (!result) {
        result = yield* resolveBuiltinItem(entry.item).pipe(
          Effect.map(
            ({ cards }) =>
              new Map(entry.item.cards.map((card, index) => [card.id, cards[index]!.key])),
          ),
          Effect.either,
        );
        keysByItem.set(entry.item, result);
        if (Either.isLeft(result)) errors.push({ entry, error: result.left });
      }
      if (Either.isLeft(result)) continue;

      const cardKey = result.right.get(entry.card.id);
      if (cardKey === undefined) {
        errors.push({
          entry,
          error: new BuiltinCardNotFound({ cardId: entry.card.id, cardKey: null }),
        });
      } else {
        items.push({ ...entry, cardKey });
      }
    }
    return { items, errors };
  });

export interface ResolvedBuiltinCard extends ItemTypeMatch {
  readonly card: ItemMetadata;
  readonly spec: EvaluableCardSpec;
}

/** Resolve by key and require that it still belongs to the same persistent card. */
export const resolveBuiltinCard = (
  item: Item,
  reference: { readonly cardId: string; readonly cardKey: string },
): Effect.Effect<
  ResolvedBuiltinCard,
  NoMatchingTypeError | ItemCardCountMismatch | BuiltinCardNotFound
> =>
  Effect.gen(function* () {
    const match = yield* resolveBuiltinItem(item);
    const { cards } = match;
    const position = cards.findIndex((card) => card.key === reference.cardKey);
    const spec = cards[position];
    const card = item.cards[position];
    if (!spec || !card || card.id !== reference.cardId) {
      return yield* new BuiltinCardNotFound(reference);
    }
    return { ...match, card, spec };
  });
