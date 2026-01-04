import type { Brand } from "effect";

export const State = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const;

export type State = (typeof State)[keyof typeof State];

export type ItemId = string & Brand.Brand<"ItemId">;

/**
 * Preserves original string representation for byte-perfect round-trip.
 * - `value`: parsed number for computations
 * - `raw`: original string for serialization
 */
export interface NumericField {
  readonly value: number;
  readonly raw: string;
}

export interface ItemMetadata {
  readonly id: ItemId;
  readonly stability: NumericField;
  readonly difficulty: NumericField;
  readonly state: State;
  readonly learningSteps: number;
  readonly lastReview: Date | null;
}

export interface Item {
  readonly cards: readonly ItemMetadata[];
  readonly content: string;
}

export interface ParsedFile {
  readonly preamble: string;
  readonly items: readonly Item[];
}
