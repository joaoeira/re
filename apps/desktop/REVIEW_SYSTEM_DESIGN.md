# Desktop Review System — Technical Design

## Overview

The desktop app gains a review system allowing users to study due and new cards from their workspace. The system reuses the workspace package's queue builder, scheduler, and deck manager, accessed from the renderer via RPC to the main process.

Three entry points into a review session:

1. **Click a deck title** — starts review for that single deck immediately
2. **Select decks via checkboxes + press Review** — starts review for the selected subset
3. **Press Review with no selection** — reviews all decks with due or new cards

---

## 1. Home Screen Changes

### 1.1 Deck Selection Model

Each deck row gains a checkbox to its left. Folder rows also get checkboxes that select all descendants recursively. Partially-selected folders display an indeterminate checkbox state.

**State**: A new `deckSelectionStore` (XState store) manages selection:

```ts
// shared/state/deckSelectionStore.ts
import { createStore } from "@xstate/store"

interface DeckSelectionContext {
  selected: Record<string, true>  // keyed by relativePath
}

// Actions:
//   toggleDeck(path)      — add/remove a single deck
//   toggleFolder(path, descendantPaths) — add/remove all descendants
//   clear()               — deselect everything
```

The store holds only leaf deck paths. Folder checkbox state (checked / indeterminate / unchecked) is derived: checked if all descendants are selected, indeterminate if some are, unchecked if none.

### 1.2 Floating Selection Toolbar

A position-fixed element anchored to bottom-center with margin. Rounded, dark-themed container with two zones separated by a vertical divider:

- **Left zone** (dashed border): selection count + cancel button — `"N selected [x]"`
- **Right zone**: `[Review]` button

Visibility rules:

| Global due+new | Selected decks | Toolbar visible | Review enabled |
|---|---|---|---|
| 0 | 0 | No | — |
| 0 | > 0 | Yes | No (disabled) |
| > 0 | 0 | Yes (shows total due) | Yes |
| > 0 | > 0 | Yes | Yes if selected decks have due+new > 0, else disabled |

When no decks are selected and there are due cards, the toolbar shows with a prompt like `"23 cards due [Review]"` (no left selection zone, just the review trigger). When decks are selected, the full two-zone layout appears.

### 1.3 Deck Title Click

Clicking the deck **name/title** navigates directly to `/review` for that single deck. This is distinct from clicking the checkbox (which toggles selection) and from clicking the row background (current behavior — needs clarification on how to separate click targets).

Implementation: the current `DeckRow` is a root `<button>` element, which cannot contain nested interactive elements (checkbox, clickable title) without breaking accessibility semantics and keyboard behavior. The row container must be refactored to a non-interactive element (e.g. `<div role="listitem">`), with the checkbox and deck title as separate, explicit interactive children. The checkbox handles selection toggling; the title (an anchor or button) triggers review navigation; the row background is not itself a click target.

### 1.4 shadcn Components Required

- **`checkbox`** — deck/folder selection with indeterminate support
- **`button`** — review trigger, grade buttons, show answer, back navigation

Both need to be installed via the shadcn CLI into `src/renderer/src/components/ui/`.

---

## 2. Routing

### 2.1 New Route: `/review`

```
src/renderer/src/routes/
  index.tsx          (existing — home screen)
  review.tsx         (new — review session)
```

TanStack Router file-based route at `/review`. Search params encode the selection:

```ts
// Route search params (validated by TanStack Router)
type ReviewSearchParams = {
  decks: "all" | string[]   // "all" or array of relative deck paths
}
```

TanStack Router handles array serialization natively (repeated query params), avoiding brittle comma-separated encoding that breaks on filenames containing commas.

The route reads the search params to determine which decks to review. Navigation from the home screen constructs the URL:

- Review all: `/review?decks=all`
- Single deck: `/review?decks=path/to/deck.md`
- Multiple decks: `/review?decks=deck1.md&decks=folder/deck2.md`

The renderer resolves the selection into absolute `deckPaths` using its cached snapshot tree before calling `BuildReviewQueue`. For `"all"`, it collects all deck paths from the tree. For an array, each relative path is resolved against `rootPath`.

### 2.2 Navigation

- **Enter review**: `router.navigate({ to: "/review", search: { decks } })`
- **Exit review**: back arrow navigates to `/` immediately, no confirmation dialog
- **Browser back**: same as back arrow — abandons session

---

## 3. Review Screen Layout

### 3.1 Structure

```
┌─────────────────────────────────────────────────┐
│  [←]  5/32  Deck Name                          │  ← header bar
│                                                 │
│                                                 │
│         ┌───────────────────────┐               │
│         │                       │               │
│         │   Prompt (markdown)   │               │  ← 60-70% width, centered
│         │                       │               │
│         │   ─────────────────   │               │  ← separator (QA only)
│         │                       │               │
│         │   Answer (markdown)   │               │  ← visible after reveal
│         │                       │               │
│         └───────────────────────┘               │
│                                                 │
│                                                 │
│         ┌───────────────────────┐               │
│         │   [Show Answer]       │               │  ← action bar (bottom center)
│         │   or                  │               │
│         │   [Again][Hard][Good][Easy]           │
│         └───────────────────────┘               │
└─────────────────────────────────────────────────┘
```

### 3.2 Header Bar

- **Back arrow**: navigates to `/`, abandoning the session
- **Card counter**: `"5/32"` — current position / total queue length
- **Deck name**: the `deckName` of the current card's source deck

### 3.3 Content Area

60-70% max-width, horizontally centered. No card styling — no borders, shadows, or background differentiation. Just rendered markdown on the page background.

**QA cards**:
- Show prompt markdown
- On reveal: answer appears below a horizontal separator (`<hr>` or similar)
- Both prompt and answer remain visible

**Cloze cards**:
- Show prompt markdown (with `[hint]` or `[...]` blanks)
- On reveal: the entire text is replaced with the reveal version, where the target deletion is rendered in **bold**

### 3.4 Action Bar

Reuses the same bottom-center fixed position as the home screen's selection toolbar. Two states:

**Pre-reveal**:
- Single `[Show Answer]` button
- Triggered by click, `Space`, or `Enter`

**Post-reveal**:
- Four grade buttons: `[Again]` `[Hard]` `[Good]` `[Easy]`
- Triggered by click or keys `1` / `2` / `3` / `4`
- Buttons disabled while grading RPC is in flight

**Session complete**: action bar is hidden.

### 3.5 Empty / Error States

- **No cards to review** (queue is empty): full-page empty state — message like "Nothing to review" with a link back to home. This is handled by the `useReviewSession` hook before the machine is created.
- **Card not found / parse error / card index out of bounds** (card broken between queue build and review): the machine silently skips to the next card via `loading`'s `onError → incrementIndex → re-enter loading`. The user never sees the broken card. If all remaining cards are broken, the machine transitions to `complete`.
- **Queue build failure**: handled outside the machine. The review route shows an error message with a link back to home.

---

## 4. State Machine

### 4.1 Desktop Review Session Machine

A new machine adapted from the CLI's `reviewSessionMachine`. Key differences:

- No `Runtime` in context — side effects go through RPC
- No `idle` state — machine starts directly in `presenting.loading` since the queue is built externally before the machine is created
- New `presenting.loading` sub-state for lazy card content fetching
- Card load errors handled directly in `loading`'s `onError` (no separate `cardError` state)
- Actors call RPC methods instead of Effect programs
- No SKIP event (removed)

```ts
// machines/desktopReviewSession.ts

interface DesktopReviewSessionContext {
  queue: readonly LightQueueItem[]
  currentIndex: number
  currentCard: CardContent | null
  reviewLogStack: readonly UndoEntry[]
  pendingGrade: FSRSGrade | null
  sessionStats: SessionStats
  error: string | null
}

interface LightQueueItem {
  readonly deckPath: string
  readonly cardId: string
  readonly cardIndex: number
  readonly deckName: string
}

interface CardContent {
  readonly prompt: string
  readonly reveal: string
  readonly cardType: "qa" | "cloze"
}

interface UndoEntry {
  readonly deckPath: string
  readonly cardId: string
  readonly previousCard: SerializedItemMetadata
  readonly rating: FSRSGrade
  readonly queueIndex: number
}

type DesktopReviewSessionEvent =
  | { type: "REVEAL" }
  | { type: "GRADE"; grade: FSRSGrade }
  | { type: "UNDO" }
  | { type: "QUIT" }
```

### 4.2 State Chart

```
presenting                                (initial state — no idle)
  loading
    entry: assign currentCard = null
    invoke: loadCardActor
    onDone → showPrompt (assign currentCard)
    onError → loading (incrementIndex) if hasMoreCards
    onError → complete if isLastCard
  showPrompt
    REVEAL → showAnswer
  showAnswer
    GRADE → grading (assign pendingGrade)
  grading
    invoke: gradingActor
    onDone → graded (push undoEntry, update stats)
    onError → showAnswer (assign error message)
    on: { UNDO: {}, QUIT: {} }        ← blocks parent handlers
  graded
    always → complete if isLastCard
    always → loading (incrementIndex)
    on: { UNDO: {}, QUIT: {} }         ← defensive, transient state

  UNDO → undoing (from presenting sub-states except grading/graded, guarded by canUndo)
  QUIT → complete (from presenting sub-states except grading/graded)

undoing
  invoke: undoActor
  onDone → presenting.loading (at restored index, pop undo stack, decrement stats)
  onError → presenting.loading (assign error message)

complete
  UNDO → undoing (guarded by canUndo)
```

**Precondition**: the machine must be created with `queue.length > 0`. The `useReviewSession` hook enforces this — if `BuildReviewQueue` returns an empty queue, the machine is never created and the route shows an empty state. An assertion at machine creation (`queue.length > 0`) guards against programming errors during development.

**Loading state visual treatment**: during `loading`, the content area is empty (or shows a minimal loading indicator). `currentCard` is cleared to `null` on entry to prevent stale content from a previous card being visible.

Card load errors (not_found, parse_error, card_index_out_of_bounds) are handled directly in `loading`'s `onError` — no separate state needed. The transition increments `currentIndex` and re-enters `loading` for the next card, or goes to `complete` if it was the last card. Broken cards are silently skipped.

**UNDO/QUIT blocking in `grading`**: The `grading` sub-state explicitly overrides the parent's UNDO and QUIT handlers with `{}` (forbidden transition in XState v5), preventing event processing during an in-flight grading RPC. This matches the CLI machine and prevents race conditions where undo could fire while the card's metadata is being written to disk. The `graded` state includes the same overrides defensively — while `graded` is transient (`always` transitions fire immediately), the overrides protect against future changes that might add guards to the `always` transitions.

**UNDO during `loading`**: the UNDO handler on the `presenting` parent fires from `loading` and `showPrompt`/`showAnswer` (but not `grading`/`graded`). XState cancels the in-flight `loadCardActor` invocation, and undo proceeds normally. The restored index re-triggers `loading` for the previous card.

**Undo after skipped errors**: if cards 1-3 errored and were skipped, undoing to card 0 will cause cards 1-3 to be re-skipped on the next pass through. The undo stack does not track which cards were skipped. This is acceptable for v1.

### 4.3 Actors

Three `fromPromise` actors that call RPC:

**`loadCardActor`** — fetches card content for the current queue item:
```ts
input: { deckPath, cardId, cardIndex }
output: CardContent  // { prompt, reveal, cardType }
// Calls GetCardContent RPC
```

**`gradingActor`** — grades the current card:
```ts
input: { deckPath, cardId, grade }
output: { previousCard: SerializedItemMetadata }
// Calls ScheduleReview RPC
// The renderer constructs the full UndoEntry from its own context
// (pendingGrade, currentIndex, current queue item) + this response
```

**`undoActor`** — reverts the last grading:
```ts
input: { deckPath, cardId, previousCard }
output: void
// Calls UndoReview RPC
```

### 4.4 SessionStats

Same as CLI:

```ts
interface SessionStats {
  reviewed: number
  again: number
  hard: number
  good: number
  easy: number
}
```

Ephemeral — not persisted. Lost when navigating away.

---

## 5. RPC Contract Extensions

### 5.1 New RPC Methods

Add to `shared/rpc/contracts.ts` and implement in `main/rpc/handlers.ts`.

#### `BuildReviewQueue`

Builds a light review queue from an explicit list of deck paths. The renderer resolves the user's selection (all / folder / multi-select) into absolute deck paths before calling this method, using `collectDeckPathsFromSelection` or the cached snapshot tree. This keeps the handler free of tree/snapshot dependencies.

```ts
// Input
Schema.Struct({
  deckPaths: Schema.Array(Schema.String),  // absolute paths, resolved by renderer
  rootPath: Schema.String,
})

// Output
Schema.Struct({
  items: Schema.Array(LightQueueItemSchema),
  totalNew: Schema.Number,
  totalDue: Schema.Number,
})

// LightQueueItemSchema
Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  cardIndex: Schema.Number,
  deckName: Schema.String,
})
```

**Handler implementation**: Calls `ReviewQueueBuilder.buildQueue({ deckPaths, rootPath, now: new Date() })` from workspace, then maps each `QueueItem` to `LightQueueItem`:

```ts
{
  deckPath: qi.deckPath,
  cardId: qi.card.id,
  cardIndex: qi.cardIndex,
  deckName: qi.deckName,
}
```

All paths in the input are validated against `rootPath` before use (see Section 6.2). The ordering strategy is hardcoded in the handler's Effect layer for v1 (`ShuffledOrderingStrategy`, matching the CLI default via `ReviewQueueLive`). Configurable ordering can be added later via a string enum param that maps to preset strategies on the main side.

#### `GetCardContent`

Reads a single card's content from disk, infers its type, and returns the rendered prompt/reveal for the specified card index.

```ts
// Input
Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  cardIndex: Schema.Number,
})

// Output
Schema.Struct({
  prompt: Schema.String,
  reveal: Schema.String,
  cardType: Schema.String,
})

// Error
CardContentErrorSchema  // not_found | parse_error
```

**Handler implementation**:
1. `DeckManager.readDeck(deckPath)` — parse the file
2. Find the item containing `cardId` by scanning `parsed.items → item.cards → card.id`. The `cardId` is authoritative — it's the stable identifier across file modifications.
3. `inferType(itemTypes, item.content)` — determine QA or Cloze
4. `type.cards(content)[cardIndex]` — get the specific card spec. If `cardIndex` is out of bounds (deck was modified and card count changed), fail with `card_index_out_of_bounds`.
5. Return `{ prompt, reveal, cardType }`

The `cardId` lookup finds the item; `cardIndex` indexes into the type-inferred card specs. These are separate concerns: `cardId` identifies which item in the file, `cardIndex` identifies which card within a multi-card item (e.g., which cloze deletion). If the deck was modified between queue build and card load, `cardId` lookup is the resilient path — the item is found by ID regardless of its position in the file. The `cardIndex` can only go stale if the item's content changed (e.g., a cloze deletion was added/removed), which is an edge case that fails gracefully via the bounds check.

This is equivalent to the CLI's `getCardSpec()` function but runs in the main process.

#### `ScheduleReview`

Grades a card and persists the updated metadata.

```ts
// Input
Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  grade: FSRSGradeSchema,  // Schema.Literal(0, 1, 2, 3)
})

// Output
Schema.Struct({
  previousCard: SerializedItemMetadataSchema,
})
```

The output contains only `previousCard` — the card's metadata before the grade was applied. The renderer already knows the `grade`, `currentIndex`, `deckPath`, and `cardId` from its own context and constructs the full `UndoEntry` locally.

**Handler implementation**:
1. `DeckManager.readDeck(deckPath)` — read current state from disk
2. Find the card by `cardId` to get its current `ItemMetadata` — this becomes `previousCard`
3. `Scheduler.scheduleReview(card, grade, new Date())` — compute new FSRS state
4. `DeckManager.updateCardMetadata(deckPath, cardId, result.updatedCard)` — persist
5. Return `{ previousCard }` (the metadata snapshot from step 2)

The card is read fresh from disk at grading time, so the renderer never holds stale `ItemMetadata`.

#### `UndoReview`

Restores a card's metadata to its previous state.

```ts
// Input
Schema.Struct({
  deckPath: Schema.String,
  cardId: Schema.String,
  previousCard: SerializedItemMetadataSchema,
})

// Output: void (Schema.Void or Schema.Struct({}))
```

**Handler implementation**: `DeckManager.updateCardMetadata(deckPath, cardId, previousCard)`.

### 5.2 Schema Requirements

New schemas defined in `shared/rpc/schemas/review.ts` (single file — these are small and cohesive):

- `LightQueueItemSchema` — struct with deckPath, cardId, cardIndex, deckName
- `FSRSGradeSchema` — `Schema.Literal(0, 1, 2, 3)`
- `SerializedItemMetadataSchema` — a **transformation schema** (not just a mirrored struct) that converts between the IPC-safe wire format and the core `ItemMetadata` type:
  - `id`: encoded as `Schema.String`, decoded with `Schema.brand("ItemId")` to restore the branded type
  - `stability`, `difficulty`: encoded as `Schema.Struct({ value: Schema.Number, raw: Schema.String })` — `raw` preserves precision (e.g. `"5.20"` stays `"5.20"`)
  - `state`: `Schema.Literal(0, 1, 2, 3)`
  - `learningSteps`: `Schema.Number`
  - `lastReview`, `due`: encoded as `Schema.NullOr(Schema.String)` (ISO 8601), decoded back to `Date | null` via `Schema.DateFromString` or equivalent transformation
  - Must round-trip perfectly — a mismatch silently corrupts card metadata on undo. The existing core schemas (`packages/core/src/schema/`) should be reused or referenced where possible.
- `CardContentErrorSchema` — tagged union for `not_found | parse_error | card_index_out_of_bounds`
- `CardContentResultSchema` — struct with prompt, reveal, cardType

### 5.3 Updated Contract

```ts
export const appContract = defineContract({
  methods: [
    // existing
    GetBootstrapData,
    ParseDeckPreview,
    ScanDecks,
    GetWorkspaceSnapshot,
    GetSettings,
    SetWorkspaceRootPath,
    // new
    BuildReviewQueue,
    GetCardContent,
    ScheduleReview,
    UndoReview,
  ] as const,
  events: [WorkspaceSnapshotChanged] as const,
})
```

---

## 6. Main Process Handler Layer

### 6.1 Service Dependencies

The new RPC handlers need access to:

- `DeckManager` — reading decks, updating card metadata
- `Scheduler` — computing FSRS schedule
- `ReviewQueueBuilder` — building the queue
- `QueueOrderingStrategy` — hardcoded to `ShuffledOrderingStrategy` for v1 (matching CLI default via `ReviewQueueLive`)

These are Effect services provided via layers. The main process handler setup needs to be extended to provide `SchedulerLive`, `DeckManagerLive`, `ReviewQueueBuilderLive`, and `ShuffledOrderingStrategy`. The `QueueOrderSpec` is not exposed over RPC — ordering is a server-side concern for v1.

### 6.2 Path Validation

All four RPC handlers accept `deckPath` (absolute paths originating from the renderer). As defense-in-depth, each handler validates that the resolved path falls within the configured workspace root before performing any filesystem operation:

```ts
const assertWithinRoot = (deckPath: string, rootPath: string) =>
  path.resolve(deckPath).startsWith(path.resolve(rootPath) + path.sep)
```

The `rootPath` is read from `SettingsRepository` in the main process — not from the renderer's RPC input — so the trust boundary is the main process's own persisted settings. `BuildReviewQueue` is the exception: it receives `rootPath` explicitly (needed by the queue builder), but the handler should cross-check it against settings.

### 6.3 getCardSpec in Main Process

The `getCardSpec` logic currently lives in `apps/cli/src/lib/getCardSpec.ts`. For the desktop, the same logic runs in the main process handler for `GetCardContent`. Rather than duplicating it, the function should be extracted to `@re/workspace` or `@re/core` so both CLI and desktop can use it.

Alternatively, the `GetCardContent` handler can inline the same three-step logic (read deck → infer type → index into cards) since it's short.

---

## 7. Markdown Rendering

### 7.1 Library Stack

- **`react-markdown`** — base markdown-to-React renderer
- **`remark-math`** — parses `$...$` and `$$...$$` into math nodes
- **`rehype-katex`** — renders math nodes with KaTeX
- **`rehype-highlight`** (or `rehype-prism-plus`) — syntax highlighting for code blocks
- **KaTeX CSS** — stylesheet for math rendering

### 7.2 Markdown Component

A shared `<MarkdownRenderer content={string} />` component wrapping `react-markdown` with the plugin chain. Used by the review screen for both prompt and reveal rendering.

```tsx
// components/markdown-renderer.tsx
import ReactMarkdown from "react-markdown"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
    >
      {content}
    </ReactMarkdown>
  )
}
```

### 7.3 Image Support

`react-markdown` renders `![alt](src)` as `<img>` tags by default. For now, images with remote URLs will render normally. Local image paths (relative to the deck file) are not resolved yet — this is a known gap to be addressed later. The rendering infrastructure supports it; only the path resolution is missing.

### 7.4 Styling

Markdown output needs prose-like typography styles. Options:

- Tailwind `@tailwindcss/typography` plugin with the `prose` class
- Custom CSS targeting the markdown container's child elements

The content area should use readable font sizing and line height. Code blocks should use the existing JetBrains Mono font from the app's theme.

---

## 8. Keyboard Shortcuts

### 8.1 Shortcut Map

| Context | Key | Action |
|---|---|---|
| Pre-reveal | `Space` | Reveal answer |
| Pre-reveal | `Enter` | Reveal answer |
| Post-reveal | `1` | Grade Again (0) |
| Post-reveal | `2` | Grade Hard (1) |
| Post-reveal | `3` | Grade Good (2) |
| Post-reveal | `4` | Grade Easy (3) |
| Any review state | `Cmd+Z` / `Ctrl+Z` | Undo last grade |

### 8.2 Implementation

A `useEffect` hook on the review screen component registers a `keydown` listener. The handler reads the current machine state to determine which keys are active:

- In `showPrompt`: space/enter → send REVEAL
- In `showAnswer`: 1/2/3/4 → send GRADE with corresponding FSRSGrade
- In `grading`: all input ignored (buttons disabled, keys no-op). Note: `Cmd+Z`/`Ctrl+Z` is also blocked during `grading` to prevent race conditions — the UNDO handler on the parent `presenting` state is overridden by the `grading` sub-state.
- In any other state with undo stack: `Cmd+Z` (macOS) or `Ctrl+Z` (cross-platform) → send UNDO. Use `event.metaKey || event.ctrlKey` to detect.

The listener calls `event.preventDefault()` on handled keys to prevent browser defaults (e.g., `Ctrl+Z` triggering browser undo). Cleaned up on unmount.

---

## 9. Session Completion

### 9.1 Completion Screen

When the queue is exhausted (or the machine enters `complete` after the last card is graded), the review screen shows an inline summary replacing the card content:

```
Session Complete

Reviewed: 32
Again: 3  |  Hard: 5  |  Good: 18  |  Easy: 6

[Back to decks]
```

The action bar is hidden. The back arrow in the header still works. `Cmd+Z` can still undo from the complete state (the undo stack persists until navigation).

### 9.2 Stats

Ephemeral — stored only in the machine's context. Lost on navigation. No persistence to disk or settings.

---

## 10. New Dependencies

### 10.1 npm Packages (renderer)

```
react-markdown
remark-math
rehype-katex
rehype-highlight
katex               (peer dep of rehype-katex, provides CSS)
```

### 10.2 shadcn Components

```sh
bunx shadcn@latest add checkbox button
```

---

## 11. File Inventory

### New Files

```
apps/desktop/src/
  renderer/src/
    routes/
      review.tsx                          # /review route
    components/
      review-session/
        review-session.tsx                # main review screen container
        card-content.tsx                  # renders prompt/answer with MarkdownRenderer
        grade-buttons.tsx                 # 4 grade buttons
        review-action-bar.tsx             # bottom floating bar (show answer / grades)
        session-summary.tsx               # completion stats
      markdown-renderer.tsx               # shared react-markdown wrapper
      selection-toolbar.tsx               # floating selection toolbar for home screen
    machines/
      desktopReviewSession.ts             # XState machine (adapted from CLI)
    hooks/
      useReviewSession.ts                 # wires machine + RPC calls
  shared/
    rpc/
      contracts.ts                        # extended with 4 new RPC methods
      schemas/
        review.ts                         # all review schemas (LightQueueItem, FSRSGrade, SerializedItemMetadata, CardContent, errors)
    state/
      deckSelectionStore.ts               # deck checkbox selection state
  main/
    rpc/
      handlers.ts                         # extended with 4 new handler implementations
```

### Modified Files

```
apps/desktop/src/
  renderer/src/
    components/
      home-screen.tsx                     # add selection toolbar, wire deck title click
      deck-list/
        deck-list.tsx                     # integrate checkboxes, selection store
        deck-row.tsx                      # add checkbox, separate title click target
    routes/
      __root.tsx                          # may need layout adjustments for floating elements
  shared/
    rpc/
      contracts.ts                        # add new methods to appContract
  main/
    rpc/
      handlers.ts                         # add new handler implementations
```

---

## 12. Implementation Order

A suggested sequencing that respects dependencies:

1. **Schemas** — define all review schemas in `shared/rpc/schemas/review.ts` (`LightQueueItemSchema`, `FSRSGradeSchema`, `SerializedItemMetadataSchema`, `CardContentResultSchema`, `CardContentErrorSchema`)
2. **RPC contracts** — add `BuildReviewQueue`, `GetCardContent`, `ScheduleReview`, `UndoReview` to `contracts.ts`
3. **RPC handlers** — implement the 4 handlers in `main/rpc/handlers.ts`, providing `SchedulerLive`, `DeckManagerLive`, `ReviewQueueBuilderLive`, `NewFirstOrderingStrategy`
4. **shadcn components** — install `checkbox` and `button`
5. **Markdown renderer** — install deps, build `<MarkdownRenderer />`
6. **Deck selection store** — `deckSelectionStore.ts`
7. **Deck row refactor** — change `DeckRow` from root `<button>` to non-interactive container with separate checkbox + title controls
8. **Home screen selection UI** — checkboxes on deck rows, folder indeterminate logic, selection toolbar
9. **XState machine** — `desktopReviewSession.ts` with loading/grading/undo actors (starts in `presenting.loading`, no idle state)
10. **Review route + screen** — `/review` route, review session component, card content rendering, action bar, keyboard shortcuts
11. **Session completion** — summary screen, undo from complete state
12. **Integration** — wire home screen entry points to `/review` navigation

---

## 13. Testing Strategy

### 13.1 State Machine Tests

The desktop review session machine should be tested in isolation using XState's `createActor` + `actor.send()` with mock `fromPromise` actors. Key scenarios:

- Full happy path: loading → showPrompt → showAnswer → grading → graded → next card → complete
- Card load error: loading → onError → skips to next card → eventually complete
- All cards broken: loading → onError chain → complete
- Undo from showPrompt, showAnswer, and complete states
- Undo during loading (cancels load, restores previous card)
- Multi-level undo (grade 3 cards, undo all 3)
- Grading error: grading → onError → back to showAnswer with error message
- UNDO and QUIT blocked during grading (events ignored, no state change)
- Empty queue assertion (machine should not be created with `queue: []`)
- QUIT from various states

### 13.2 RPC Handler Tests

Test with mock Effect services (`DeckManager`, `Scheduler`, `ReviewQueueBuilder`) using Effect's test utilities. Verify:

- `BuildReviewQueue` correctly maps full `QueueItem` to `LightQueueItem`
- `GetCardContent` handles: card found, card not found, deck not found, parse error, cardIndex out of bounds
- `ScheduleReview` reads fresh from disk, schedules, persists, and returns `previousCard`
- `UndoReview` restores card metadata correctly
- `SerializedItemMetadataSchema` round-trips with `ItemMetadata` (dates as ISO↔Date, NumericField raw preservation, ItemId branding, null dates)

### 13.3 Selection Store Tests

- Toggle deck on/off
- Toggle folder selects/deselects all descendants
- Partial deselection of folder descendants
- Clear resets all
- Folder checkbox state derivation (checked / indeterminate / unchecked)

---

## 14. Known Limitations and Future Work

- **Undo is best-effort**: `UndoReview` restores `previousCard` without a compare-and-swap check. If the card was externally modified between grading and undo, the external edit is overwritten. Acceptable for a single-user local app; revisit if collaborative editing is added.
- **Undo re-skips broken cards**: after undoing past a sequence of error-skipped cards, those cards will be re-attempted (and re-skipped) on the next forward pass. The undo stack does not track which cards were skipped.
- **Repeated file parses**: `GetCardContent` re-reads and parses the full deck file for every card. If 20 cards come from the same deck, that's 20 parses. Sub-10ms each on SSD so not a v1 concern, but a lightweight LRU cache keyed by `deckPath + mtime` in the handler would eliminate this. Good candidate for a fast follow-up.
- **No timeout on card loading**: if `GetCardContent` RPC hangs (e.g., unresponsive filesystem), there is no timeout on `loadCardActor`. The user's only option is to navigate back (QUIT). Adding a timeout to the actor invocation is a future improvement.
- **Local image paths**: `react-markdown` renders `<img>` tags for markdown images, but relative paths (relative to the deck file) are not resolved to `file://` URLs yet. Remote images work. Path resolution is deferred.
- **Configurable ordering**: Queue ordering is hardcoded for v1. To make it configurable, add a string enum param to `BuildReviewQueue` (e.g. `"new-first" | "due-first" | "shuffled"`) that maps to preset strategy layers on the main side. No need to serialize function-bearing `QueueOrderSpec` over IPC.
- **Stale snapshot on return**: After a review session mutates deck files, the home screen snapshot may be momentarily stale until the `WorkspaceWatcher` fires. The watcher's 300ms debounce should make this imperceptible in practice.
