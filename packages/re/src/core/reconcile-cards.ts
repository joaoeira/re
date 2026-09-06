import { Data, Either, Option } from "effect";
import type { ItemMetadata } from "./types.js";

export class DuplicateCardKey extends Data.TaggedError("DuplicateCardKey")<{
  readonly key: string;
}> {
  override get message(): string {
    return `Generated card key is not unique within the item: ${this.key}`;
  }
}

export class ReconcileCardCountMismatch extends Data.TaggedError("ReconcileCardCountMismatch")<{
  readonly keyCount: number;
  readonly metadataCount: number;
}> {
  override get message(): string {
    return `Cannot match ${this.metadataCount} metadata record(s) to ${this.keyCount} generated card key(s).`;
  }
}

export type ReconcileError = DuplicateCardKey | ReconcileCardCountMismatch;

/**
 * Preserve complete metadata records by key, in the order of nextKeys.
 * None denotes a new card; the caller chooses when to create its ID and metadata.
 * Type changes must be handled by the caller before matching these local keys.
 */
export const reconcileCards = (
  previous: {
    readonly keys: readonly string[];
    readonly cards: readonly ItemMetadata[];
  },
  nextKeys: readonly string[],
): Either.Either<readonly Option.Option<ItemMetadata>[], ReconcileError> => {
  if (previous.keys.length !== previous.cards.length) {
    return Either.left(
      new ReconcileCardCountMismatch({
        keyCount: previous.keys.length,
        metadataCount: previous.cards.length,
      }),
    );
  }

  for (const keys of [previous.keys, nextKeys]) {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) return Either.left(new DuplicateCardKey({ key }));
      seen.add(key);
    }
  }

  const byKey = new Map(previous.keys.map((key, index) => [key, previous.cards[index]!]));
  return Either.right(nextKeys.map((key) => Option.fromNullable(byKey.get(key))));
};
