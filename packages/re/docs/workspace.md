# @simbyotic/re/workspace

Filesystem deck management, discovery, snapshots, image assets, and review queues
for Markdown spaced repetition workspaces. The entry point exports ESM JavaScript
and TypeScript declarations and uses Effect services.

Callers supply the filesystem and path implementations. Their service keys come from
`effect/FileSystem` and `effect/Path`; `@effect/platform` is no longer a dependency.
Node applications use `@effect/platform-node@4.0.0-rc.112` alongside the exact
`effect@4.0.0-rc.112` peer:

First pin the adapter's transitive prerelease in your application's `package.json`:

```json
{
  "overrides": {
    "@effect/platform-node-shared": "4.0.0-rc.112"
  }
}
```

The Node adapter declares a range for this dependency. Without the override, a
fresh install can select a later release candidate that requires a newer Effect.

```sh
npm install effect@4.0.0-rc.112 @effect/platform-node@4.0.0-rc.112
```

```ts
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { Effect, Layer } from "effect";
import { DeckManager, DeckManagerLive } from "@simbyotic/re/workspace";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const program = Effect.gen(function* () {
  const decks = yield* DeckManager;
  return yield* decks.readDeck("/absolute/path/to/deck.md");
});

const deck = await Effect.runPromise(
  program.pipe(Effect.provide(DeckManagerLive.pipe(Layer.provide(platform)))),
);
```

For `appendItem`, `replaceItem`, and `modifyItem`, pass a type adapted with `adaptItemType` from `@simbyotic/re/core`
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
request handlers instead of rebuilding `DeckManagerLive` for each request, so reviews
and authoring operations use the same per-deck locks.

In a v4 layer graph, reuse the same manager layer object across queue and study branches.
Services use explicit `Context.Service` contracts, and manager methods capture their
filesystem/path dependencies. Their returned Effects need no additional service context.
Filesystem failures use v4 `PlatformError` wrappers; recovery is selected by typed
`Effect.catchReason`/`Effect.catchReasons` handlers before producing public domain errors.

Scheduling is provided by `@simbyotic/re/scheduler`; import `Scheduler` and `SchedulerLive` from that
package. Workspace uses its due-date helpers for snapshots and review queues. Discovery uses
Markdown files and honors the workspace's `.reignore`. Image hashing requires Web Crypto, available
in the Node runtimes exercised by the consumer check.

## Review queues and deck errors

`QueueItem` identifies the saved card through `card.id` and includes its item snapshot. It no
longer exposes `cardIndex`; `filePosition` is only an ordering hint within the snapshot. Apps
capture generated keys using their item-type resolver and carry those keys in review references.
The raw queue builder remains item-type agnostic; `prepareBuiltinReviewQueue` resolves the built-in types.

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
Every error includes `deckPath` and a descriptive `message`. `DeckNotFound` and `CardNotFound`
provide diagnostic message getters; `toReadErrorMessage` and `toWriteErrorMessage` provide shared
UI wording. Underlying filesystem diagnostics may still contain absolute paths.
Successful decks continue to contribute cards when another deck fails. `deckErrors` preserves
the input path order, including repeated failed paths, regardless of read completion order.
It is unaffected by category filters, card ordering, or card limits, including a limit of zero.
`totalNew` and `totalDue` count only cards in the final `items` array.

Empty decks and decks with no eligible cards do not produce errors. An empty queue with
nonempty `deckErrors` is an incomplete result, so an app should report those failures rather
than treating it as confirmation that the selected decks are up to date. Defects and
interruption propagate through Effect; they are never converted into deck errors.
The selection-based `ReviewQueueService` returns the same result type.

Shuffling preserves membership and multiplicity. `Random.withSeed(seed)` gives
reproducible ordering within the pinned v4 implementation; the old v3 seed sequence
is not retained. Category grouping and ordering before limits are unchanged.

Apps choose whether to show failures alongside available cards or require every deck to load:

```ts
import { Effect } from "effect";
import { ReviewQueueBuilder } from "@simbyotic/re/workspace";

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

## Built-in review operations

`prepareBuiltinReviewQueue({ rootPath, deckPaths, now, options? })` requires `ReviewQueueBuilder`.
It forwards category and ordering options, resolves each item once, and applies `cardLimit` after
invalid cards have been skipped. The result contains `cards`, `totalNew`, `totalDue`, and `issues`;
both counts describe the final selection.

Each prepared card contains a `{ deckPath, cardId, cardKey }` reference, deck name, relative path,
category, and `{ prompt, reveal, cardType }` content. Content is a preparation-time snapshot;
freshness-sensitive callers should re-read through `DeckManager` and resolve the current item.

Issues retain typed errors: `kind: "deck"` includes `deckPath` and a `ReadError`;
`kind: "card"` includes `deckPath`, `relativePath`, `cardId`, and a `NoMatchingTypeError`,
`ItemCardCountMismatch`, or `BuiltinCardNotFound`. Recoverable failures are collected in issues,
so preparation has no typed failure channel. Defects and interruption still propagate.

`gradeBuiltinCard(reference, grade, now)` requires `DeckManager | Scheduler`. It re-resolves
identity against the current item and schedules current metadata inside the deck lock, returning
`previousCard`, `updatedCard`, `schedulerLog`, and the evaluated `grade` only after saving.
Its typed errors are `WriteError | CardNotFound | NoMatchingTypeError | ItemCardCountMismatch |
BuiltinCardNotFound | ResponseValidationError | ScheduleError`.

Content edits are permitted while the ID/key identity still resolves. This operation does not
detect whether the caller displayed older content. Applications retain ownership of session state,
undo tokens, analytics, access checks, and error presentation. Both operations are plain Effect
functions and require no additional service layer.

Build locally with `bun run build`. From the repository root, `bun run pack:library`
creates the installable package archive and `bun run check:packages` verifies it in an isolated Node consumer.
