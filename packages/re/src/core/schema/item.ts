import { Schema } from "effect";
import type { Item, ParsedFile } from "../types.js";
import { ItemMetadataSchema } from "./metadata.js";

/** Validate an in-memory item; content interpretation belongs to its ItemType. */
export const ItemSchema = Schema.Struct({
  cards: Schema.Array(ItemMetadataSchema),
  content: Schema.String,
}).annotate({ identifier: "Item" }) satisfies Schema.Codec<Item>;

/** Validate an in-memory file; this schema does not parse Markdown or JSON. */
export const ParsedFileSchema = Schema.Struct({
  preamble: Schema.String,
  items: Schema.Array(ItemSchema),
}).annotate({ identifier: "ParsedFile" }) satisfies Schema.Codec<ParsedFile>;
