# @re/types

Standard Q&A and cloze card implementations for `@re/core`. This package contains runtime
parsers and card generation as well as TypeScript declarations. It exports ESM JavaScript
and uses Effect for parsing and grading.

```ts
import { Effect } from "effect";
import { QAType, ClozeType } from "@re/types";

const qa = Effect.runSync(QAType.parse("Capital of France?\n---\nParis"));
const qaCards = QAType.cards(qa);

const cloze = Effect.runSync(ClozeType.parse("{{c1::Paris}} is in {{c2::France}}."));
const clozeCards = ClozeType.cards(cloze);
```

Q&A content separates question and answer with a line containing `---`. Cloze content uses
`{{c1::hidden text}}` syntax, with one card per distinct cloze index.

Build locally with `bun run build`. From the repository root, `bun run pack:libraries`
creates installable archives and `bun run check:packages` verifies them in an isolated Node consumer.
