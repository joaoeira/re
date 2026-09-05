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
