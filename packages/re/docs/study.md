# Study workflows

`@simbyotic/re/study` supplies application-independent services used by Raycast
and re Pocket. It requires the same `effect` and `@effect/platform` peers as
workspace services.

`ReviewStore` has an explicit service contract for starting a new/due session,
loading a card, saving an edit, grading, undoing a grade, deleting a source note,
and restoring a deleted note. `makeReviewStoreLive(transform)` constructs its
layer and requires `ReviewQueueBuilder`, `DeckManager`, `Scheduler`, filesystem,
and path services. The transform receives the workspace/deck context and raw
Markdown; use `(_context, markdown) => Effect.succeed(markdown)` for renderers
that accept source Markdown directly.

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
