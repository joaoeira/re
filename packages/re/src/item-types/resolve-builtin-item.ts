import { Data, Effect, Result } from "effect";
import {
  adaptItemType,
  matchItemTypes,
  type Item,
  type ItemMetadata,
  type EvaluableCardSpec,
  type ItemTypeMatch,
  type ItemCardCountMismatch,
  type NoMatchingTypeError,
} from "../core/index.js";
import { ClozeType } from "./cloze.js";
import { QAType } from "./qa.js";

// This order also controls the repair fallback in ItemCardCountMismatch.
// A count-matching cloze interpretation wins over a count-matching Q&A one.
const builtinTypes = [adaptItemType(ClozeType), adaptItemType(QAType)] as const;

export interface BuiltinCardSpec extends EvaluableCardSpec {
  readonly cardType: "qa" | "cloze";
}

export interface ResolvedBuiltinItem extends ItemTypeMatch {
  readonly cards: readonly BuiltinCardSpec[];
}

const isBuiltinCardType = (name: string): name is BuiltinCardSpec["cardType"] =>
  name === "qa" || name === "cloze";

export const resolveBuiltinItem = (
  item: Item,
): Effect.Effect<ResolvedBuiltinItem, NoMatchingTypeError | ItemCardCountMismatch> =>
  matchItemTypes(builtinTypes, item).pipe(
    Effect.flatMap(([match]) => {
      const cardType = match.type.name;
      return isBuiltinCardType(cardType)
        ? Effect.succeed({ ...match, cards: match.cards.map((spec) => ({ ...spec, cardType })) })
        : Effect.die(new Error(`Unexpected built-in item type: ${cardType}`));
    }),
  );

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

interface AnnotatedBuiltinCardSpecs<Entry> {
  readonly items: readonly { readonly entry: Entry; readonly spec: BuiltinCardSpec }[];
  readonly errors: AnnotatedBuiltinCards<Entry>["errors"];
}

/** Shared with workspace preparation; resolves each item once per batch. */
export const annotateBuiltinCardSpecs = <
  Entry extends { readonly item: Item; readonly card: Pick<ItemMetadata, "id"> },
>(
  entries: readonly Entry[],
): Effect.Effect<AnnotatedBuiltinCardSpecs<Entry>> =>
  Effect.gen(function* () {
    const specsByItem = new Map<
      Item,
      Result.Result<
        ReadonlyMap<string, BuiltinCardSpec>,
        NoMatchingTypeError | ItemCardCountMismatch
      >
    >();
    const items: Array<{ readonly entry: Entry; readonly spec: BuiltinCardSpec }> = [];
    const errors: Array<AnnotatedBuiltinCards<Entry>["errors"][number]> = [];

    for (const entry of entries) {
      let result = specsByItem.get(entry.item);
      if (!result) {
        result = yield* resolveBuiltinItem(entry.item).pipe(
          Effect.map(
            ({ cards }) => new Map(entry.item.cards.map((card, index) => [card.id, cards[index]!])),
          ),
          Effect.result,
        );
        specsByItem.set(entry.item, result);
        if (Result.isFailure(result)) errors.push({ entry, error: result.failure });
      }
      if (Result.isFailure(result)) continue;

      const spec = result.success.get(entry.card.id);
      if (spec === undefined) {
        errors.push({
          entry,
          error: new BuiltinCardNotFound({ cardId: entry.card.id, cardKey: null }),
        });
      } else {
        items.push({ entry, spec });
      }
    }
    return { items, errors };
  });

/** Keep resolvable cards in queue order and report each invalid item once. */
export const annotateBuiltinCardKeys = <
  Entry extends { readonly item: Item; readonly card: Pick<ItemMetadata, "id"> },
>(
  entries: readonly Entry[],
): Effect.Effect<AnnotatedBuiltinCards<Entry>> =>
  annotateBuiltinCardSpecs(entries).pipe(
    Effect.map(({ items, errors }) => ({
      items: items.map(({ entry, spec }) => ({ ...entry, cardKey: spec.key })),
      errors,
    })),
  );

export interface ResolvedBuiltinCard extends ResolvedBuiltinItem {
  readonly card: ItemMetadata;
  readonly spec: BuiltinCardSpec;
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
