import { Schema } from "effect";
import type { ItemId } from "../types.ts";

export const ItemIdSchema: Schema.Schema<ItemId, string> = Schema.String.pipe(
  Schema.nonEmptyString(),
  Schema.brand("ItemId")
) as Schema.Schema<ItemId, string>;

export const isItemId = (s: string): s is ItemId => s.length > 0;
