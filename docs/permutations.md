# Review Session Permutations Assistant

## Purpose

This document describes the design and implementation plan for adding a permutations workflow to the desktop review session. The user should be able to press `cmd+k` during review, choose `Create permutations`, open a right-hand assistant sidebar for the current card, generate candidate cards, edit them locally, and append selected candidates to the current deck.

This is intentionally **not** a forge integration. Forge is useful as a precedent for the user experience and for prompt quality, but the review feature should not inherit forge session semantics, forge repository IDs, or forge persistence requirements.

## Problem Statement

The current review flow exposes only a rendered card view to the renderer:

- The review queue in [`packages/workspace/src/reviewQueue.ts`](../packages/workspace/src/reviewQueue.ts) carries the full `Item` and `ItemMetadata`, but that richer structure does not cross the desktop RPC boundary.
- Desktop review reduces queue identity to `LightQueueItem` in [`apps/desktop/src/shared/rpc/schemas/review.ts`](../apps/desktop/src/shared/rpc/schemas/review.ts).
- `GetCardContent` in [`apps/desktop/src/main/rpc/handlers/review.ts`](../apps/desktop/src/main/rpc/handlers/review.ts) parses the underlying item but only returns `prompt`, `reveal`, and `cardType`.
- The review session machine in [`apps/desktop/src/renderer/src/machines/desktopReviewSession.ts`](../apps/desktop/src/renderer/src/machines/desktopReviewSession.ts) stores only that rendered card view.

That representation is sufficient for review presentation and grading. It is not sufficient for AI-assisted generation, because generation needs access to the **canonical source card content**, not merely the currently rendered review face.

Forge already has permutation generation, but the forge path is tightly coupled to forge entities:

- `ForgeGenerateCardPermutations` requires a numeric `sourceCardId`.
- Generated permutations are persisted in the forge session repository.
- The renderer panel in forge assumes numeric permutation IDs, mutation-backed editing, and persisted `addedCount`.

Review needs the same class of outcome, but with different semantics:

- The current review card is identified by review identity (`deckPath`, `cardId`, `cardIndex`), not forge IDs.
- Generated permutations should be ephemeral UI state, not persisted analytical rows.
- Adding a generated card should use the normal deck append path, not forge analytics bookkeeping.

## Design Goals

1. Add a review-scoped command workflow opened by `cmd+k` on macOS and `ctrl+k` on other platforms.
2. Keep review session grading, undo, and queue progression behavior unchanged.
3. Reuse canonical card content definitions from `@re/types` rather than inventing a third source-card model.
4. Avoid forge repository coupling entirely.
5. Make the architecture extendable to future review assistant actions and future non-QA card support.
6. Keep generated permutations ephemeral for v1.
7. Use the existing generic deck append path when adding generated cards.
8. Prevent in-flight generation responses for card `N` from being applied after the session has already advanced to card `N + 1`.

## Explicit Non-Goals

1. Do not create or reuse forge sessions for review generation.
2. Do not persist generated review permutations in SQLite.
3. Do not attempt to retroactively insert newly added cards into the active review queue.
4. Do not rename the existing prompt runtime service as part of this feature unless that rename becomes necessary for implementation. The current `ForgePromptRuntimeService` name is inaccurate for the new use case, but renaming it is a separate refactor.
5. Do not attempt full cloze permutation support in the first functional slice unless the prompt behavior is clearly specified. The system should be structured for future cloze support without pretending that cloze is already solved.

## Core Architectural Decision

The assistant feature should be split across two domains:

- **Review domain** owns card identity, current-card lifecycle, keyboard integration, panel state, and interaction with the active review session.
- **Type domain (`@re/types`)** owns canonical parsed card content.

This means the new design should use:

- review identity from the existing review RPC layer
- canonical parsed content from `QAContent`, `ClozeContent`, and `ClozeDeletion` in `@re/types`

It should **not** use:

- the existing review rendered-card payload as the assistant source model
- forge source-card IDs
- forge repository entities

## Existing Types to Reuse

### Review identity

The review session already uses the correct addressing information:

- `deckPath`
- `cardId`
- `cardIndex`

This identity already exists in:

- `GetCardContent` input
- `LightQueueItem`
- the current review session queue state

No new persistence or deck indexing is required to address the current card.

### Canonical content

Canonical content definitions already exist in `@re/types`:

- [`packages/types/src/qa.ts`](../packages/types/src/qa.ts)
  - `QAContent`
  - `QAType`
- [`packages/types/src/cloze.ts`](../packages/types/src/cloze.ts)
  - `ClozeContent`
  - `ClozeDeletion`
  - `ClozeType`

These types represent the real item content. They are the correct basis for assistant generation.

### Important distinction

`QAContent` and `ClozeContent` are not equivalent to the current review payload:

- `QAContent` is canonical source content for a QA item.
- `ClozeContent` is canonical source content for a cloze item, including deletion metadata.
- `prompt` / `reveal` is a derived review-facing projection of a single card generated from the canonical source.

The assistant should be driven by canonical source content, then optionally derive display content from that source as needed.

## Recommended Shared Schema Additions

The review schema module should gain a typed assistant source model rather than continuing to rely on the rendered `CardContentResultSchema`.

### Public v1 source-card schema

The public review assistant schema should be **QA-only in v1**.

This is the correct compromise between correctness and transport safety:

- it reuses canonical source content from `@re/types`
- it avoids prematurely exposing cloze transport semantics before cloze generation exists
- it avoids pushing `Option<string>` from `ClozeContent` across the RPC boundary before schema compatibility is proven

Recommended v1 shape:

```ts
export const ReviewAssistantQaSourceCardSchema = Schema.Struct({
  cardType: Schema.Literal("qa"),
  content: QAContent,
});
```

This shape does three important things:

1. It reuses canonical schemas from `@re/types`.
2. It makes the v1 support boundary explicit instead of implying nonexistent cloze support.
3. It avoids a transport design that would later need to be broken once cloze semantics are clarified.

### Internal cloze note

Internally, the review handler should still detect cloze items with `inferType([QAType, ClozeType])`. That is necessary so the system can fail with `assistant_unsupported_card_type` instead of collapsing cloze into a generic parse error.

When cloze support is eventually added, the public review assistant schema should not expose raw `ClozeContent` unchanged unless the transport behavior of `Option<string>` has been explicitly validated. The safer design is a dedicated transport schema with JSON-safe fields and a resolved target deletion identity.

### Schema import caveat

`apps/desktop/src/shared/rpc/schemas/*` mostly imports `Schema` from `@effect/schema`, while `@re/types` currently defines schemas using `Schema` from `effect`. In practice these may interoperate, but that should be verified before composing the QA schema directly.

If composition works, import the schemas directly from `@re/types`.

If composition does not work cleanly, the correct response is **not** to duplicate the field definitions ad hoc in review. Instead, introduce a small shared re-export or adapter layer so the canonical source schema still has one owner.

## Recommended RPC Surface

The cleanest implementation-ready design is **two RPCs**, not one.

The earlier single-RPC design was too overloaded. The sidebar needs source-card context before generation succeeds, during generation, and after generation failure. That is impossible if source-card data exists only in a successful generation response.

The correct split is:

1. a source-card read method for sidebar context
2. a generation method for permutations

The generation method should still resolve the source card server-side again for correctness. The read method exists for UI state, not as an authority handoff to the renderer.

### Proposed method 1

`GetReviewAssistantSourceCard`

### Proposed input

```ts
export const GetReviewAssistantSourceCardInputSchema = Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  cardIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
```

### Proposed output

```ts
export const GetReviewAssistantSourceCardResultSchema = Schema.Struct({
  sourceCard: ReviewAssistantQaSourceCardSchema,
});
```

### Proposed error surface

```ts
export class ReviewAssistantUnsupportedCardTypeError extends Schema.TaggedError<ReviewAssistantUnsupportedCardTypeError>(
  "@re/desktop/rpc/ReviewAssistantUnsupportedCardTypeError",
)("assistant_unsupported_card_type", {
  cardType: Schema.String,
  message: Schema.String,
}) {}

export const ReviewAssistantSourceCardErrorSchema = Schema.Union(
  CardContentErrorSchema,
  ReviewAssistantUnsupportedCardTypeError,
);
```

This explicitly includes the existing `not_found`, `read_error`, `parse_error`, and `card_index_out_of_bounds` taxonomy through `CardContentErrorSchema`.

### Proposed method 2

`ReviewGeneratePermutations`

### Proposed input

```ts
export const ReviewGeneratePermutationsInputSchema = Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  cardIndex: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  instruction: Schema.optional(Schema.String),
  model: Schema.optional(ModelIdSchema),
});
```

This deliberately reuses the same identity already used by `GetCardContent`.

### Proposed output

```ts
export const ReviewGeneratedPermutationSchema = Schema.Struct({
  id: Schema.String,
  question: Schema.String,
  answer: Schema.String,
});

export const ReviewGeneratePermutationsResultSchema = Schema.Struct({
  permutations: Schema.Array(ReviewGeneratedPermutationSchema),
});
```

The `id` should be ephemeral and local to the response, not a persisted database ID. It should be generated with `randomUUID()` in the main process so rows remain stable within a response and cannot collide across regenerations.

### Proposed error surface

The generation method should have a review-specific error union, for example:

```ts
export class ReviewAssistantUnsupportedCardTypeError extends Schema.TaggedError<ReviewAssistantUnsupportedCardTypeError>(
  "@re/desktop/rpc/ReviewAssistantUnsupportedCardTypeError",
)("assistant_unsupported_card_type", {
  cardType: Schema.String,
  message: Schema.String,
}) {}

export class ReviewPermutationGenerationError extends Schema.TaggedError<ReviewPermutationGenerationError>(
  "@re/desktop/rpc/ReviewPermutationGenerationError",
)("review_permutation_generation_error", {
  message: Schema.String,
}) {}

export const ReviewGeneratePermutationsErrorSchema = Schema.Union(
  CardContentErrorSchema,
  ReviewAssistantUnsupportedCardTypeError,
  ReviewPermutationGenerationError,
);
```

This is preferable to collapsing everything into `ReviewOperationError`, because:

- unsupported-card behavior is a real product state, not a generic operational failure
- the method genuinely can return `not_found` and `parse_error`
- the test plan can now match the actual contract instead of depending on undocumented error remapping

### Why separate source fetch and generate are both needed

The sidebar needs source-card context before generation finishes. Therefore:

- `GetReviewAssistantSourceCard` powers the sidebar header and source summary
- `ReviewGeneratePermutations` powers the actual AI action

The generation method should still resolve source state server-side again rather than trusting the renderer's previously loaded source card. That preserves the important benefits of server-side authority:

- the renderer does not become the source-of-truth for parsed card content
- the server always uses current deck state
- card parsing rules remain centralized in the main process

## Prompt Design

### New prompt module

Create a new prompt spec for review permutations rather than overloading the forge prompt.

Recommended location:

- `apps/desktop/src/main/review/prompts/generate-review-permutations.ts`

The prompt runtime service can still be the existing `ForgePromptRuntimeService` in v1. That service name is inaccurate, but the runtime itself is generic over `PromptSpec<Input, Output>`. The naming cleanup can happen later.

### Prompt input

The prompt input should be explicit about source-card type:

```ts
export const GenerateReviewPermutationsPromptInputSchema = Schema.Struct({
  sourceCard: ReviewAssistantQaSourceCardSchema,
  instruction: Schema.optional(Schema.String),
});
```

### Prompt output

The prompt output can stay QA-oriented for v1:

```ts
export const GenerateReviewPermutationsPromptOutputSchema = Schema.Struct({
  permutations: Schema.Array(
    Schema.Struct({
      question: Schema.String,
      answer: Schema.String,
    }),
  ),
});
```

### Initial support policy

The source schema should be extendable, but the public v1 support boundary should be explicit:

- if the current review card resolves to QA, generation is supported
- if the current review card resolves to cloze, the source-card read and generation methods should fail with `assistant_unsupported_card_type`

That is the correct first cut. It preserves future extensibility without pretending that cloze permutations are already well-defined.

### Why the prompt still should not accept raw `{ question, answer }`

A raw `{ question, answer }` prompt input would throw away the source-card abstraction immediately. The prompt should still accept a structured source-card object, even if that object is QA-only in v1.

### Why not reuse forge prompt input

Forge permutations explicitly depend on source text context and forge source-card semantics. Review permutations do not. The review prompt should therefore omit `chunkText` entirely and derive its instructions solely from the source card.

## Main Process Changes

### Shared schemas and contracts

Files to change:

- `apps/desktop/src/shared/rpc/schemas/review.ts`
- `apps/desktop/src/shared/rpc/contracts/review.ts`
- `apps/desktop/src/shared/rpc/contracts.ts`

Add:

- QA source-card schema
- source-card read input/result/error schemas
- generation input/result/error schemas
- new `GetReviewAssistantSourceCard` contract
- new `ReviewGeneratePermutations` contract

### Review handler implementation

File to change:

- `apps/desktop/src/main/rpc/handlers/review.ts`

Implementation outline:

1. Validate deck access the same way `GetCardContent` already does.
2. Read the deck and locate the current item with `findCardLocationById`.
3. Parse the underlying item content with `inferType([QAType, ClozeType])`.
4. Resolve a QA source-card if the parsed item is QA.
5. If the parsed item is cloze, fail with `assistant_unsupported_card_type`.
6. Implement `GetReviewAssistantSourceCard` on top of that resolver.
7. Implement `ReviewGeneratePermutations` by calling the same resolver again and then invoking the prompt runtime.
8. Normalize prompt output:
   - trim whitespace
   - drop empty question/answer pairs
   - dedupe exact duplicates
   - optionally filter out a candidate identical to the source QA pair
9. Return ephemeral permutations with `randomUUID()` row IDs.

### Helper extraction

The review handler should not inline a pile of parsing and branching logic. Add a local helper or helper module for:

- resolving a QA source card from review identity
- normalizing generated permutations

That keeps `GetCardContent`, `GetReviewAssistantSourceCard`, and `ReviewGeneratePermutations` aligned and avoids three divergent implementations of card parsing inside the same handler file.

### Concurrency and write safety

Concurrent append and grading operations are already serialized at the deck-write layer. Both:

- `AppendItem` in `apps/desktop/src/main/rpc/handlers/editor.ts`
- `ScheduleReview` in `apps/desktop/src/main/rpc/handlers/review.ts`

go through `deckWriteCoordinator.withDeckLock(...)`.

This should be stated explicitly in the implementation so reviewers are not forced to infer safety from existing handler code.

### Runtime service choice

Use the existing prompt runtime service for v1:

- `ForgePromptRuntimeService`

This should be treated as a pragmatic reuse, not a naming endorsement. Do not make the review feature block on a broad rename of the prompt runtime abstraction.

## Renderer Changes

### Review session layout

File to change:

- `apps/desktop/src/renderer/src/components/review-session/review-session.tsx`

The review screen currently renders a simple central content column and action bar. It needs to become a layout that can optionally host a right-hand assistant sidebar.

Recommended shape:

- main review content remains central
- assistant sidebar is mounted conditionally on the right
- command dialog overlays the page

### New local UI state

The review session component should own local assistant state rather than pushing this into the review machine.

Recommended state:

- `commandDialogOpen: boolean`
- `assistantPanel: null | "permutations"`
- `assistantCardKey: string | null`
- `sourceCardQuery` state keyed by card identity
- generation result state for the active card
- local edited drafts for generated permutations
- pending add state per generated row
- append error state per generated row
- generation error state
- source-card load error state, if not fully query-owned
- `activeGenerationRequestRef` containing the current card key and request token

`assistantCardKey` is useful for scoping local generation state, but it is not sufficient as the only reset signal. `CARD_EDITED` can reload the same card with the same `deckPath`, `cardId`, and `cardIndex`.

### Why this should not live in `desktopReviewSessionMachine`

The review machine is concerned with:

- loading
- presenting
- grading
- undo
- completion

Assistant UI state is orthogonal. Putting command dialogs, side panels, and local draft edits into the machine would widen its responsibility without improving determinism. This feature should stay as component state unless the assistant grows into a much larger workflow.

### Command dialog

Add a lightweight dialog component under review-session components, for example:

- `apps/desktop/src/renderer/src/components/review-session/review-command-dialog.tsx`

Behavior:

- opened by `cmd+k` or `ctrl+k`
- contains one option in v1: `Create permutations`
- selecting that option closes the dialog and opens the permutations panel

This should be built as a thin action picker, not a full application-wide command palette system.

### Assistant sidebar

Add a review-specific sidebar component, for example:

- `apps/desktop/src/renderer/src/components/review-session/review-permutations-sidebar.tsx`

Responsibilities:

- display source-card summary
- display source-card loading and failure states
- show generation state
- trigger generation
- render locally editable generated permutations
- append a selected permutation to the current deck

### Data fetching strategy

Split data fetching by concern.

Recommended pattern:

- add a centralized query key factory in `apps/desktop/src/renderer/src/lib/query-keys.ts`
- use a query keyed by review card identity for `GetReviewAssistantSourceCard`
- use a mutation for `ReviewGeneratePermutations`
- keep generated permutations and local drafts in component state
- reset local generation state when the review machine re-enters `presenting.loading`

This matches the actual data semantics:

- source-card context is server state derived from current review identity
- generated permutations are ephemeral mutation results, not canonical persisted state

The source-card query should use `skipToken` when the assistant sidebar is closed or there is no active card.

### Reset trigger and same-card reload detection

Reset logic must not rely solely on card-identity changes. When the current card is edited, the review machine re-enters `presenting.loading`, but the identity tuple:

- `deckPath`
- `cardId`
- `cardIndex`

can remain unchanged.

The authoritative reset signal should therefore be a transition into `presenting.loading`.

Recommended implementation:

1. Track the previous loading state in a ref.
2. Detect transitions from "not loading" to `snapshot.matches({ presenting: "loading" })`.
3. On that transition:
   - close the assistant sidebar
   - close the command dialog
   - clear generated permutations and local drafts
   - clear row-scoped append state
   - clear `activeGenerationRequestRef`
   - invalidate the source-card query for the previously active assistant key
4. After invalidation, clear or update `assistantCardKey` as appropriate for the next card.

This one mechanism covers both card advance and same-card reload after `CARD_EDITED`.

### In-flight generation staleness guard

Reset-on-card-change alone is insufficient. `useMutation` does not automatically cancel or suppress an already running request. Without an explicit guard, the success handler for card `N` can write stale rows into a sidebar now showing card `N + 1`.

The implementation must use a request-scoped staleness guard.

Recommended pattern:

1. Build a stable `cardKey` from `deckPath`, `cardId`, and `cardIndex`.
2. When generation starts, create a `requestId` with `crypto.randomUUID()`.
3. Store `{ cardKey, requestId }` in a ref such as `activeGenerationRequestRef`.
4. In `onSuccess` and `onError`, compare the captured `{ cardKey, requestId }` for that mutation against the current ref.
5. If either value does not match, ignore the callback result entirely.
6. On card change, sidebar close, or panel reset, clear the ref so late completions become no-ops.

Example shape:

```ts
const activeGenerationRequestRef = useRef<{
  readonly cardKey: string;
  readonly requestId: string;
} | null>(null);
```

This is preferable to pretending cancellation exists when the IPC method does not currently expose a cancellation contract.

### Add-to-deck path

Use the existing generic editor append method:

- contract: `AppendItem`
- handler: `apps/desktop/src/main/rpc/handlers/editor.ts`

The review assistant should append generated QA content to the current card's `deckPath`.
The append payload must explicitly set `cardType: "qa"`.

It should **not** call `ForgeAddCardToDeck`, because that method carries forge-specific semantics and analytics side effects.

### Local editing semantics

Unlike forge, edited review permutations should not be round-tripped to the server after each keystroke. They do not exist as server-owned entities.

Recommended behavior:

- server returns generated rows
- renderer creates local draft state keyed by ephemeral row ID
- edits are applied locally only
- add-to-deck serializes the current local draft values

This is simpler and more honest than faking persistence for ephemeral content.

### Row-scoped add state

A single generic append error state is not sufficient. The UI needs row-scoped feedback because one append can fail while other rows remain actionable.

Recommended shape:

- `addingRowIds: ReadonlySet<string>`
- `appendErrorByRowId: ReadonlyMap<string, string>`
- optionally `addedRowIds: ReadonlySet<string>` if the UI should visually lock successful rows

Append success or failure should only update the state for the affected row.

## Keyboard and Focus Behavior

This is one of the most important implementation details.

The current review screen listens on `window` and handles:

- `cmd/ctrl+z` for undo
- `e` for edit
- `space` / `enter` for reveal
- `1` through `4` for grading

Once a dialog and editable sidebar exist, the current behavior becomes wrong unless keyboard handling is gated.

### Required gating rules

Review hotkeys must be ignored when:

1. the command dialog is open
2. the assistant sidebar has focus in an editable field
3. the event target is an input, textarea, select, or contenteditable element
4. a mutation is in progress that should suppress action replay, if needed

### Recommended implementation

Add a small helper, local to review-session or under `lib`, such as:

```ts
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};
```

That helper is necessary but not sufficient. Buttons and other focusable controls inside the command dialog are not editable targets, so dialog-open state must be checked separately.

Recommended early-return helper:

```ts
const shouldSuppressReviewHotkeys = ({
  commandDialogOpen,
  assistantPanelContainsTarget,
  target,
}: {
  readonly commandDialogOpen: boolean;
  readonly assistantPanelContainsTarget: boolean;
  readonly target: EventTarget | null;
}): boolean => commandDialogOpen || assistantPanelContainsTarget || isEditableTarget(target);
```

This should be driven either by a ref to the sidebar root plus `sidebarRef.current?.contains(target as Node)`, or by an equivalent containment check. A plain `assistantPanelOpen` boolean is acceptable but broader than necessary.

The important part is the ordering:

- the suppression check must happen **before** any key-specific matching
- it must happen before `cmd/ctrl+z`
- it must happen before reveal and grading logic

Otherwise:

- `Space` on a dialog button can trigger `REVEAL`
- `cmd+z` inside an editable assistant field can trigger review undo instead of text undo
- `1` through `4` in an editable assistant field can trigger grading
- `Space` or `Enter` on a focused sidebar button can trigger `REVEAL`

### `cmd+k` ownership

`cmd+k` should be owned by the review session component only while the review route is active and only when a current card is present. It should not become a global application shortcut in this feature.

## State Reset Rules

The assistant is scoped to the current review card, so it needs explicit reset behavior.

### Reset when the active card changes

When the current card identity changes because of:

- reveal -> grade -> next card
- undo
- card edited and reloaded
- card deleted

the assistant state should be cleared.

Recommended behavior:

- close the sidebar
- close the command dialog
- clear generated permutations
- clear draft edits
- clear add errors
- invalidate the source-card query for the previously active assistant key

This avoids showing stale content for the wrong card.

### Do not try to preserve generation across cards in v1

Per-card assistant caching sounds attractive, but it introduces more state management and very little value in the first version. The correct v1 behavior is a hard reset on card change, combined with the explicit generation staleness guard described above.

## Add-to-Deck Behavior

### Content serialization

For QA permutations, content should be serialized using the same separator convention already used by editor and forge:

```ts
`${question}\n---\n${answer}\n`;
```

That logic already exists in renderer-side helpers, but if reuse becomes awkward across review and forge, move it to a shared utility rather than duplicating string formatting.

### Destination deck

The generated card should be appended to the current card's `deckPath`.

This is the behavior implied by "add them to the current deck".

### Review queue behavior after append

Newly appended cards should **not** be inserted into the active review queue. The queue is built at session start and should remain stable for the lifetime of the session.

This should be documented in code comments or UI copy if confusion is likely.

### Duplicate detection

V1 should not block on duplicate detection unless product requirements explicitly demand it.

Reasons:

- forge add-to-deck does not currently run duplicate checks either
- duplicate checks would add another asynchronous branch per generated row
- the review feature is already substantial without introducing duplicate-resolution UX

If duplicate detection is later desired, the existing `CheckDuplicates` editor path can be reused before append.

## Testing Plan

### Main-process tests

Add tests in:

- `apps/desktop/test/main/rpc-handlers/review.test.ts`

Cases:

1. QA source card generates permutations successfully.
2. QA source card read returns canonical `sourceCard` metadata in the response.
3. QA source card read succeeds for a review QA item.
4. Cloze source card read returns `assistant_unsupported_card_type`.
5. Generation for a cloze review item returns `assistant_unsupported_card_type`.
6. Missing card returns `not_found`.
7. Unreadable deck returns `read_error`.
8. Out-of-bounds card index returns `card_index_out_of_bounds`.
9. Parse failure returns `parse_error` when the source item cannot be parsed.
10. Prompt runtime failure maps to `review_permutation_generation_error`.
11. Output normalization removes blank and duplicate candidates.
12. Generated row IDs are UUID-backed and non-repeating across regenerations.

### Renderer tests

Add browser tests under `apps/desktop/test/renderer/`.

Cases:

1. `cmd+k` opens the review command dialog.
2. Selecting `Create permutations` opens the sidebar.
3. While dialog or sidebar editor is focused, reveal and grading hotkeys do not fire.
4. While a textarea or contenteditable in the sidebar is focused, `cmd+z` does not dispatch review undo.
5. Generation success renders candidate rows.
6. A stale generation completion for card `N` is ignored after the session advances to card `N + 1`.
7. Editing a generated row updates local state only.
8. Clicking `Add` calls `AppendItem` with current draft content.
9. One row-level append failure does not poison other rows.
10. Pressing `Space` or `Enter` on a focused sidebar button does not trigger review reveal.
11. Re-entry into `presenting.loading` resets assistant state even when the card identity tuple does not change.
12. Same-card reload after `CARD_EDITED` invalidates the source-card query.
13. Card progression resets and closes the assistant UI.
14. Unsupported-card response shows a clear message instead of a broken panel.

### Machine tests

The review state machine likely does not need modification. If it stays unchanged, no new machine tests should be added merely to satisfy coverage vanity. The behavior under test belongs in component tests.

## File-Level Change Plan

### Shared / contracts

- `apps/desktop/src/shared/rpc/schemas/review.ts`
  - add QA source-card schema
  - add source-card read input/output/error schemas
  - add generation input/output/error schemas
- `apps/desktop/src/shared/rpc/contracts/review.ts`
  - add `GetReviewAssistantSourceCard`
  - add `ReviewGeneratePermutations`
- `apps/desktop/src/shared/rpc/contracts.ts`
  - register the new methods

### Main process

- `apps/desktop/src/main/rpc/handlers/review.ts`
  - implement the new handlers
  - extract helper(s) for source-card resolution and normalization
- `apps/desktop/src/main/review/prompts/generate-review-permutations.ts`
  - add the new prompt spec
- optionally `apps/desktop/src/main/review/prompts/index.ts`
  - if a small review prompt namespace is introduced

### Renderer

- `apps/desktop/src/renderer/src/lib/query-keys.ts`
  - add `reviewAssistantSourceCard(...)`
- `apps/desktop/src/renderer/src/components/review-session/review-session.tsx`
  - layout changes
  - hotkey gating
  - assistant state ownership
- `apps/desktop/src/renderer/src/components/review-session/review-command-dialog.tsx`
  - new component
- `apps/desktop/src/renderer/src/components/review-session/review-permutations-sidebar.tsx`
  - new component
- `apps/desktop/src/renderer/src/hooks/queries/use-review-assistant-source-card-query.ts`
  - new query hook
- `apps/desktop/src/renderer/src/hooks/mutations/use-review-generate-permutations-mutation.ts`
  - new mutation hook
- optionally `apps/desktop/src/renderer/src/hooks/mutations/use-append-item-mutation.ts`
  - if append logic should be reused cleanly outside the editor

### Tests

- `apps/desktop/test/main/rpc-handlers/review.test.ts`
- new browser tests under `apps/desktop/test/renderer/`

## Recommended Implementation Sequence

### Phase 1: backend contract and prompt

1. Add shared review assistant schemas and contracts.
2. Add the new review permutations prompt spec.
3. Implement server-side source resolution in the review handler.
4. Implement `GetReviewAssistantSourceCard`.
5. Implement `ReviewGeneratePermutations`.
6. Add main-process tests for QA success and cloze unsupported behavior.

At the end of this phase the main process should be able to resolve source-card context and generate permutations for a review card without any renderer work.

### Phase 2: renderer integration

1. Add command dialog UI.
2. Add sidebar shell and source-card query wiring.
3. Implement hotkey suppression before any editable sidebar control is introduced.
4. Wire generation mutation and explicit staleness guard.
5. Implement reset-on-machine-loading and source-card query invalidation.
6. Implement local draft editing.
7. Reuse `AppendItem` for add-to-deck with `cardType: "qa"` and row-scoped append state.

At the end of this phase the feature should be functionally complete.

### Phase 3: keyboard and polish

1. Add error display for unsupported-card and generation failures.
2. Add browser tests.

## Open Questions

### 1. Should cloze be represented in the public v1 review assistant schema?

Recommendation: no.

Reason:

- cloze generation is unsupported in v1
- `ClozeContent` contains `Option` fields that deserve an explicit transport decision before they cross RPC
- QA-only transport keeps the contract honest while still reusing canonical `QAContent`

### 2. Should cloze be hidden in the command dialog or shown and then rejected?

Recommendation: hide or disable the action when `currentCard.cardType === "cloze"` in v1.

Reason:

- it avoids a dead-end interaction
- the backend should still validate and reject cloze for correctness
- the UI should not invite an action that product does not yet support

### 3. Should the prompt runtime be renamed now?

Recommendation: no.

Reason:

- the runtime implementation is already generic
- renaming touches DI, live layers, tests, and main wiring
- the review feature should not be delayed by a naming refactor

### 4. Should generated permutations be cached per card within the session?

Recommendation: no for v1.

Reason:

- it increases UI state complexity
- it introduces stale-state edge cases after card edits
- the user can regenerate quickly when needed

### 5. What cloze identity should future support use?

Recommendation: not raw `cardIndex` alone.

Reason:

- `cardIndex` is the position in the derived review-card array
- cloze semantics actually depend on the resolved deletion target
- future public cloze transport should include a resolved target deletion identity, not just the array index

## Final Recommendation

Implement this as a **review assistant feature**, not a forge transplant.

The correct data split is:

- review types for current-card identity and session lifecycle
- `@re/types` for canonical card content

The correct user-flow split is:

- a lightweight command dialog in review
- a right-hand permutations sidebar backed by a dedicated source-card read method
- a separate review generation RPC that resolves the canonical source card server-side again for correctness
- deck insertion through the generic `AppendItem` path with `cardType: "qa"`

The most important technical constraints are:

- do not treat the current review `prompt` / `reveal` projection as the source of truth
- do not let in-flight generation callbacks write stale data after card transitions
- do not expose transport schemas that imply cloze support before the cloze transport contract is actually designed

The assistant should operate on canonical parsed content, with explicit response-staleness guards in the renderer, so that the feature remains correct as the review session advances and remains extensible when the architecture later expands beyond QA.
