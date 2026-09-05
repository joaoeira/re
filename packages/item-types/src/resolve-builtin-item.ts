import { Data, Effect, Option } from "effect";
import {
  adaptItemType,
  matchItemTypes,
  type Item,
  type ItemMetadata,
  type EvaluableCardSpec,
  type ItemTypeMatch,
  type ItemCardCountMismatch,
  type NoMatchingTypeError,
} from "@re/core";
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

/** Capture a generated key from the same saved snapshot as its metadata ID. */
export const getBuiltinCardKey = (
  item: Item,
  cardId: string,
): Effect.Effect<string, NoMatchingTypeError | ItemCardCountMismatch | BuiltinCardNotFound> =>
  Effect.gen(function* () {
    const { cards } = yield* resolveBuiltinItem(item);
    const position = item.cards.findIndex((card) => card.id === cardId);
    const spec = cards[position];
    if (!spec) return yield* new BuiltinCardNotFound({ cardId, cardKey: null });
    return spec.key;
  });

/** Preserve queue order and fields, resolving each shared item snapshot only once. */
export const annotateBuiltinCardKeys = <
  Entry extends { readonly item: Item; readonly card: Pick<ItemMetadata, "id"> },
>(
  entries: readonly Entry[],
): Effect.Effect<Array<Entry & { readonly cardKey: string | null }>> =>
  Effect.gen(function* () {
    const keysByItem = new Map<Item, ReadonlyMap<string, string>>();
    return yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        let keys = keysByItem.get(entry.item);
        if (!keys) {
          const match = yield* resolveBuiltinItem(entry.item).pipe(Effect.option);
          keys = new Map(
            Option.isSome(match)
              ? entry.item.cards.map((card, index) => [card.id, match.value.cards[index]!.key])
              : [],
          );
          keysByItem.set(entry.item, keys);
        }
        return { ...entry, cardKey: keys.get(entry.card.id) ?? null };
      }),
    );
  });

export interface ResolvedBuiltinCard extends ItemTypeMatch {
  readonly card: ItemMetadata;
  readonly spec: EvaluableCardSpec;
}

/** Resolve by key and require that it still belongs to the same persistent card. */
export const resolveBuiltinCard = (
  item: Item,
  reference: { readonly cardId: string; readonly cardKey: string | null },
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
