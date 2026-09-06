# @simbyotic/re-workspace

Filesystem deck management, discovery, snapshots, image assets, and review queues
for Markdown spaced repetition workspaces. The package exports ESM JavaScript
and TypeScript declarations and uses Effect services.

Callers supply the filesystem and path implementations. For example, a Node application
can install `@effect/platform-node` alongside this package and `effect`:

```ts
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import { DeckManager, DeckManagerLive } from "@simbyotic/re-workspace";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const program = Effect.gen(function* () {
  const decks = yield* DeckManager;
  return yield* decks.readDeck("/absolute/path/to/deck.md");
});

const deck = await Effect.runPromise(
  program.pipe(Effect.provide(DeckManagerLive.pipe(Layer.provide(platform)))),
);
```

For `appendItem`, `replaceItem`, and `modifyItem`, pass a type adapted with `adaptItemType` from `@simbyotic/re-core`
(for example, `adaptItemType(QAType)`). Workspace uses its `parseCards` operation to validate
the content, ensure that metadata and generated card counts match, and reject duplicate card keys.
Writing content does not evaluate responses or run graders.

`modifyItem(deckPath, cardId, change, itemType)` reads the current item, runs the Effect-returning
`change(current)` callback, validates the result, and saves it while holding the deck lock.
It returns the saved item after the write completes. If another item follows, it adds a trailing
newline so the next metadata line remains parseable. A failing callback leaves the file
byte-for-byte unchanged and preserves the callback's typed error. `replaceItem` is a thin wrapper
for replacements that do not depend on the current item.

Prepare new content before calling `modifyItem`; read the old keys and reconcile metadata inside
its callback, where concurrent reviews cannot intervene. For a type change, create fresh metadata
instead of matching keys from different namespaces. For an explicit repair request, check whether
the current item still needs repair inside the callback before returning fresh metadata. If another
edit already repaired it, reconcile normally so its healthy learning data survives.

`modifyCardMetadata(deckPath, cardId, change)` provides the current `{ item, card }` under the
same lock. Its callback returns `{ metadata, result }`; the manager saves the metadata and
returns `result` only after the save succeeds. Grading should resolve the current card's key
and ID, evaluate the response, and compute the schedule inside this callback. Conditional
undo should check its expected metadata there before returning the metadata to restore.
`updateCardMetadata` wraps this operation for unconditional metadata replacements.

Neither callback may call another mutation on the same deck: the lock is not reentrant and
such a call would deadlock. Keep it focused on computing the replacement. External side effects
inside the callback are not rolled back if later validation or saving fails.

## Concurrent writes

Reuse one `DeckManager` instance for operations that may overlap. Its content edits
(`modifyCardMetadata`, `updateCardMetadata`, `modifyItem`, `replaceItem`, `appendItem`, `removeItem`, and `restoreItem`)
each hold a per-deck lock across reading, changing, and saving the file. Concurrent
edits to different items therefore preserve one another's changes. Unrelated decks
can be edited concurrently, including while an item type is validating content.
Create, delete, and rename share those locks; rename acquires both paths in a
consistent order. An earlier save finishes before a waiting delete or rename.

Content saves use a unique temporary file beside the deck and atomically rename
it into place. A failed or interrupted save cleans up its temporary file. An
interruption before the rename leaves the original deck intact; once the rename
starts, it finishes before the lock is released, so cancellation can still leave
the completed edit on disk.

Locks belong to the service instance and use normalized absolute paths. They do
not coordinate separate instances, other processes, external editors, or symlink
aliases. A separate `readDeck` followed by an update is not a transaction. Replacing
the same item with stale content can still overwrite a newer replacement; the
later replacement wins. Apps that coordinate several calls as one workflow still
need their own coordination around that workflow.

Service lifetime matters at application boundaries: capture a shared instance when creating
RPC handlers instead of rebuilding `DeckManagerLive` for each request. The desktop handler
bundle does this so reviews, editor saves, and Forge writes use the same per-deck locks.

Scheduling is provided by `@simbyotic/re-scheduler`; import `Scheduler` and `SchedulerLive` from that
package. Workspace uses its due-date helpers for snapshots and review queues. Discovery uses
Markdown files and honors the workspace's `.reignore`. Image hashing requires Web Crypto, available
in the Node runtimes exercised by the consumer check.

## Review queues and deck errors

`QueueItem` identifies the saved card through `card.id` and includes its item snapshot. It no
longer exposes `cardIndex`; `filePosition` is only an ordering hint within the snapshot. Apps
capture generated keys using their item-type resolver and carry those keys in review references.
The workspace package does not depend on built-in item types.

`ReviewQueueBuilder.buildQueue` returns usable cards alongside recoverable deck-loading errors:

```ts
interface ReviewQueue {
  readonly items: readonly QueueItem[];
  readonly totalNew: number;
  readonly totalDue: number;
  readonly deckErrors: readonly ReadError[];
}
```

`ReadError` is the existing union of `DeckNotFound`, `DeckReadError`, and `DeckParseError`.
Every error includes `deckPath`; read and parse errors also carry a descriptive `message`.
Successful decks continue to contribute cards when another deck fails. `deckErrors` preserves
the input path order, including repeated failed paths, regardless of read completion order.
It is unaffected by category filters, card ordering, or card limits, including a limit of zero.
`totalNew` and `totalDue` count only cards in the final `items` array.

Empty decks and decks with no eligible cards do not produce errors. An empty queue with
nonempty `deckErrors` is an incomplete result, so an app should report those failures rather
than treating it as confirmation that the selected decks are up to date. Defects and
interruption propagate through Effect; they are never converted into deck errors.
The selection-based `ReviewQueueService` returns the same result type.

Apps choose whether to show failures alongside available cards or require every deck to load:

```ts
import { Effect } from "effect";
import { ReviewQueueBuilder } from "@simbyotic/re-workspace";

const prepareReview = Effect.gen(function* () {
  const builder = yield* ReviewQueueBuilder;
  const queue = yield* builder.buildQueue({
    deckPaths: ["/decks/geography.md", "/decks/chemistry.md"],
    rootPath: "/decks",
    now: new Date(),
  });

  // This app requires every selected deck. Other apps can display all errors
  // and offer queue.items for review instead.
  if (queue.deckErrors.length > 0) {
    return yield* Effect.fail(queue.deckErrors[0]!);
  }
  return queue;
});
```

Build locally with `bun run build`. From the repository root, `bun run pack:libraries`
creates installable archives and `bun run check:packages` verifies them in an isolated Node consumer.
