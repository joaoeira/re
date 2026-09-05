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

Build locally with `bun run build`. From the repository root, `bun run pack:libraries`
creates installable archives and `bun run check:packages` verifies them in an isolated Node consumer.
