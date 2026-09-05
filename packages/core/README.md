# @re/core

Parse, serialize, and create Markdown spaced repetition items and their scheduling metadata.
The package exports ESM JavaScript and TypeScript declarations. Its asynchronous and fallible
APIs use Effect.

```ts
import { Effect } from "effect";
import { createMetadata, parseFile, serializeFile } from "@re/core";

const markdown = serializeFile({
  preamble: "# Geography\n\n",
  items: [{ cards: [createMetadata()], content: "Capital of France?\n---\nParis\n" }],
});
const parsed = Effect.runSync(parseFile(markdown));
```

Content and preamble are preserved; metadata is serialized canonically. Each item can contain
multiple cards sharing one content block. The package also exports card-type contracts and
cloze syntax helpers. Filesystem operations belong to `@re/workspace`; standard card types
are provided by `@re/item-types`.

## Parsing one metadata record

`parseMetadata` accepts one complete `<!--@ ... -->` comment, with an optional LF or CRLF
line ending. It rejects additional content or lines and shares field decoding with `parseFile`.
Both return `MetadataParseError` failures; standalone diagnostics refer to line 1.

```ts
import { Effect } from "effect";
import { parseMetadata, serializeMetadata } from "@re/core";

const metadata = Effect.runSync(
  parseMetadata(
    "<!--@ imported-card 5.20 4.30 2 0 2025-01-04T10:30:00+02:00 2025-01-09T10:30:00+02:00-->",
  ),
);

serializeMetadata(metadata);
// <!--@ imported-card 5.20 4.30 2 0 2025-01-04T08:30:00.000Z 2025-01-09T08:30:00.000Z-->
```

The parser supports the same five- and seven-field layouts as `parseFile`, but requires
the first closing `-->` to end the record. The file parser retains its more permissive line
matching, which can absorb an embedded closing delimiter into an ID. Numeric spelling is
preserved, and parsed timestamps become `Date` objects. A malformed comment or
field count fails with `InvalidMetadataFormat`; invalid field values fail with `InvalidFieldValue`.
The five-field layout has no timestamps; the seven-field layout includes both `lastReview`
and `due`. A record with only a last-review timestamp is rejected. `serializeMetadata`
requires both timestamps or neither and throws `RangeError` for an incomplete pair.

## Validating in-memory models

`ItemMetadataSchema`, `ItemSchema`, and `ParsedFileSchema` validate the corresponding public
models and can be composed into an app's own Effect schemas. They retain their struct fields
for schema composition.

```ts
import { Effect, Schema } from "effect";
import { createMetadata, ItemSchema, ParsedFileSchema } from "@re/core";

const ImportRequest = Schema.Struct({ deckPath: Schema.String, item: ItemSchema });
const request = Effect.runSync(
  Schema.decodeUnknown(ImportRequest)({
    deckPath: "/decks/geography.md",
    item: {
      cards: [createMetadata()],
      content: "Capital of France?\n---\nParis\n",
    },
  }),
);
const file = Effect.runSync(
  Schema.decodeUnknown(ParsedFileSchema)({ preamble: "", items: [request.item] }),
);
```

These schemas validate object structure using the existing field schemas. `lastReview` and
`due` must be `null` or valid `Date` objects; timestamp strings and invalid Dates are rejected.
Encoding also returns in-memory objects with Dates, not a JSON representation. Markdown
parsing and serialization remain the responsibility of `parseFile` and `serializeFile`.

Validation does not establish relationships between fields: it does not check that a numeric
field's `raw` spelling agrees with its `value`, enforce unique IDs, or interpret item content
and check its generated card count. The existing field schemas and constructors are unchanged;
validating an object is not a guarantee that arbitrary metadata can round-trip through Markdown.

Two concrete examples pass structural validation but cannot retain their meaning in Markdown:

- Metadata with only one of `lastReview` and `due` set: serialization rejects the incomplete
  timestamp pair with `RangeError`.
- An item with `cards: []`: serialization writes its content without a metadata separator.
  Parsing again merges that content into the preceding item or the file preamble.

## Discovering and evaluating cards

Use `adaptItemType` to register types with different content and response shapes, then call
`inferCards` to discover ready-to-use cards. The first matching parser wins. Each card exposes
`prompt`, `reveal`, `cardType`, and `evaluate(response)`. Evaluation decodes an unknown response
with the card's schema before invoking its grader, which can run synchronously or asynchronously.

```ts
import { Effect, Schema } from "effect";
import { adaptItemType, ContentParseError, inferCards, type ItemType } from "@re/core";
import { ClozeType, QAType } from "@re/item-types";

const VocabularyType: ItemType<{ readonly answer: string }, string> = {
  name: "vocabulary",
  parse: (raw) =>
    raw.startsWith("vocabulary:")
      ? Effect.succeed({ answer: raw.slice("vocabulary:".length) })
      : new ContentParseError({
          type: "vocabulary",
          raw,
          message: "Expected vocabulary: prefix",
        }),
  cards: ({ answer }) => [
    {
      prompt: "Type the answer",
      reveal: answer,
      cardType: "vocabulary",
      responseSchema: Schema.String,
      grade: (response) => Effect.succeed(response === answer ? 2 : 0),
    },
  ],
};

const types = [adaptItemType(QAType), adaptItemType(ClozeType), adaptItemType(VocabularyType)];

const review = Effect.gen(function* () {
  const { cards } = yield* inferCards(types, "vocabulary:Paris");
  const card = cards[0]!;
  return yield* card.evaluate("Paris"); // 2; a different string produces 0
});
```

An invalid response, such as a number submitted to the vocabulary card, fails with
`ResponseValidationError` before grading starts. The error includes `cardType`, `message`, and
the underlying Schema parse error as `cause`. A valid but incorrect answer is graded normally.
Custom grading errors pass through unchanged and remain in the inferred Effect error union
alongside `ResponseValidationError`, so callers can handle them with `Effect.catchTag`.

For asynchronous checking, the type's `grade` can return an `Effect.tryPromise` or another
asynchronous Effect. Evaluation remains lazy and supports Effect interruption and finalizers.
Apps collect responses, display pending states, and pass successful grades to the scheduler.
Provide any services required by a grader within its implementation; the existing `CardSpec`
contract exposes an Effect with no outstanding service requirements.

Direct use of a known `ItemType` retains its precise content and response types. Use `inferCards`
for discovery across a collection: it keeps parsing and card construction together so consumers
never need to pass unknown parsed content back into a type-specific implementation. Pass an
adapted item type to workspace's `appendItem` and `replaceItem` methods as well; they validate
content and card counts through `parseCards` without evaluating any responses.
The isolated scheduler consumer exercises mixed built-in
types and an externally defined asynchronous grader through validation and scheduling.

Build locally with `bun run build`. From the repository root, `bun run pack:libraries`
creates installable archives and `bun run check:packages` verifies them in an isolated Node consumer.
