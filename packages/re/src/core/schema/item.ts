import { Schema } from "effect";
import type { Item, ParsedFile } from "../types.js";
import { ItemMetadataSchema } from "./metadata.js";

/** Validate an in-memory item; content interpretation belongs to its ItemType. */
export const ItemSchema = Schema.Struct({
  cards: Schema.Array(ItemMetadataSchema),
  content: Schema.String,
}).annotations({ identifier: "Item" }) satisfies Schema.Schema<Item>;

/** Validate an in-memory file; this schema does not parse Markdown or JSON. */
export const ParsedFileSchema = Schema.Struct({
  preamble: Schema.String,
  items: Schema.Array(ItemSchema),
}).annotations({ identifier: "ParsedFile" }) satisfies Schema.Schema<ParsedFile>;
