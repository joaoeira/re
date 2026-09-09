import { Schema } from "effect";
import type { ItemId, ItemMetadata } from "../types.js";
import { LearningStepsFromString } from "./learning-steps.js";
import { NumericFieldSchema } from "./numeric.js";
import { StateSchema } from "./state.js";

export const ItemIdSchema: Schema.Codec<ItemId, string, never, never> = Schema.String.check(
  Schema.isNonEmpty(),
).pipe(Schema.brand("ItemId"));

export const isItemId = (s: string): s is ItemId => s.length > 0;

/**
 * Validate in-memory metadata using the existing field schemas and valid Dates.
 * This does not validate relationships between fields or the Markdown encoding.
 */
export const ItemMetadataSchema = Schema.Struct({
  id: Schema.toType(ItemIdSchema),
  stability: NumericFieldSchema,
  difficulty: NumericFieldSchema,
  state: StateSchema,
  learningSteps: Schema.toType(LearningStepsFromString),
  lastReview: Schema.NullOr(Schema.Date),
  due: Schema.NullOr(Schema.Date),
}).annotate({ identifier: "ItemMetadata" }) satisfies Schema.Codec<ItemMetadata>;
