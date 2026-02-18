import { nanoid } from "nanoid";
import type { ItemId, ItemMetadata, NumericField, State } from "./types";

export const generateId = (): ItemId => nanoid() as ItemId;

/**
 * Create a NumericField from a number value.
 * Uses toString() for the raw representation.
 *
 * Note: Number.toString() can emit "1e-7" for very small numbers.
 * For round-trip scenarios, use the parsed NumericField directly.
 */
export const numericField = (value: number): NumericField => ({
  value,
  raw: value.toString(),
});

/**
 * Create a fresh ItemMetadata record for a new item.
 * State is New (0), with no review history.
 */
export const createMetadata = (): ItemMetadata => ({
  id: generateId(),
  stability: numericField(0),
  difficulty: numericField(0),
  state: 0 as State,
  learningSteps: 0,
  lastReview: null,
  due: null,
});

/**
 * Create ItemMetadata with a specific ID (useful for testing or migrations).
 */
export const createMetadataWithId = (id: ItemId): ItemMetadata => ({
  id,
  stability: numericField(0),
  difficulty: numericField(0),
  state: 0 as State,
  learningSteps: 0,
  lastReview: null,
  due: null,
});
