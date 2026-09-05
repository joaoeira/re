import { Schema } from "effect";
import type { ItemId, ItemMetadata } from "../types.js";
import { LearningStepsFromString } from "./learning-steps.js";
import { NumericFieldSchema } from "./numeric.js";
import { StateSchema } from "./state.js";

export const ItemIdSchema: Schema.Schema<ItemId, string> = Schema.String.pipe(
  Schema.nonEmptyString(),
  Schema.brand("ItemId"),
) as Schema.Schema<ItemId, string>;

export const isItemId = (s: string): s is ItemId => s.length > 0;

/**
 * Validate in-memory metadata using the existing field schemas and valid Dates.
 * This does not validate relationships between fields or the Markdown encoding.
 */
export const ItemMetadataSchema = Schema.Struct({
  id: Schema.typeSchema(ItemIdSchema),
  stability: NumericFieldSchema,
  difficulty: NumericFieldSchema,
  state: StateSchema,
  learningSteps: Schema.typeSchema(LearningStepsFromString),
  lastReview: Schema.NullOr(Schema.ValidDateFromSelf),
  due: Schema.NullOr(Schema.ValidDateFromSelf),
}).annotations({ identifier: "ItemMetadata" }) satisfies Schema.Schema<ItemMetadata>;
