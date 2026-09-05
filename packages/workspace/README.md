# @re/workspace

Filesystem deck management, discovery, snapshots, image assets, and review queues
for Markdown spaced repetition workspaces. The package exports ESM JavaScript
and TypeScript declarations and uses Effect services.

Callers supply the filesystem and path implementations. For example, a Node application
can install `@effect/platform-node` alongside this package and `effect`:

```ts
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import { DeckManager, DeckManagerLive } from "@re/workspace";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const program = Effect.gen(function* () {
  const decks = yield* DeckManager;
  return yield* decks.readDeck("/absolute/path/to/deck.md");
});

const deck = await Effect.runPromise(
  program.pipe(Effect.provide(DeckManagerLive.pipe(Layer.provide(platform)))),
);
```

For `appendItem` and `replaceItem`, pass a type adapted with `adaptItemType` from `@re/core`
(for example, `adaptItemType(QAType)`). Workspace uses its `parseCards` operation to validate
the content and ensure that the number of metadata records matches the generated cards.
Writing content does not evaluate responses or run graders.

Scheduling is provided by `@re/scheduler`; import `Scheduler` and `SchedulerLive` from that
package. Workspace uses its due-date helpers for snapshots and review queues. Discovery uses
Markdown files and honors the workspace's `.reignore`. Image hashing requires Web Crypto, available
in the Node runtimes exercised by the consumer check.

Build locally with `bun run build`. From the repository root, `bun run pack:libraries`
creates installable archives and `bun run check:packages` verifies them in an isolated Node consumer.
