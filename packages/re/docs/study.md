# Study workflows

`@simbyotic/re/study` supplies application-independent authoring and review services.
It shares the exact `effect@4.0.0-rc.112` peer with the other entry points. Filesystem
and path abstractions come from Effect core; Node consumers supply
`@effect/platform-node@4.0.0-rc.112`. Pocket uses the v4 workspace library and the
same pinned Node adapter.

`ReviewStore` has an explicit service contract for starting a new/due session,
loading a card, saving an edit, grading, undoing a grade, deleting a source note,
and restoring a deleted note. `makeReviewStoreLive(transform)` constructs its
layer and requires `ReviewQueueBuilder`, `DeckManager`, `Scheduler`, filesystem,
and path services. The transform receives the workspace/deck context and raw
Markdown; use `(_context, markdown) => Effect.succeed(markdown)` for renderers
that accept source Markdown directly.

Compose one manager layer shared by the stores and queue builder:

```ts
import { Effect, Layer } from "effect";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { SchedulerLive } from "@simbyotic/re/scheduler";
import {
  DeckManagerLive,
  ReviewQueueBuilderLive,
  NewFirstOrderingStrategy,
} from "@simbyotic/re/workspace";
import { DeckStoreLive, makeReviewStoreLive } from "@simbyotic/re/study";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const manager = DeckManagerLive.pipe(Layer.provideMerge(platform));
const queue = ReviewQueueBuilderLive.pipe(
  Layer.provide(Layer.merge(manager, NewFirstOrderingStrategy)),
);
const stores = Layer.merge(
  DeckStoreLive,
  makeReviewStoreLive((_context, markdown) => Effect.succeed(markdown)),
).pipe(Layer.provide(Layer.mergeAll(manager, queue, SchedulerLive)));
```

Once constructed, store methods capture their dependencies and require no additional
Effect services. The Markdown transform can require `Path.Path`; the review store
supplies it and wraps transform failures as `ReviewCardLoadError`. Reuse the manager
layer object so grading through `ReviewStore` and appending through `DeckStore`
share the same deck lock.

Sessions are queue snapshots. Grading returns an undo token containing the
previous metadata, and deletion returns a token containing the removed source
item. Clients own queue position, session statistics, confirmation, and undo
history. Removing a cloze note must remove every queued reference whose card ID
belongs to the loaded note's `sourceCardIds`. Editing preserves card identities
and scheduling and rejects adding, removing, or renumbering cloze indices during
review.

`DeckStore` and `DeckStoreLive` expose discovery, append, and image import.
`prepareCard` validates Q&A/cloze drafts, while `createCardForUi` returns a
creation result or a field/operation error. `appendNextClozeTemplate` appends the
next numbered placeholder. `insertImageForUi` reads through the
`ClipboardImageReader` service and imports through `DeckStore`; each host
supplies its own clipboard implementation. No host UI or clipboard API is loaded
by this entry point.
