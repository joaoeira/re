# Forge — AI Card Generation for Re Desktop

## 1. Vision

Forge is a full AI-driven card generation pipeline built into the Re desktop app. It takes PDF source material, extracts text with page-boundary tracking, chunks it, extracts topics via LLM, lets the user select topics of interest, generates Q&A flashcards per topic, and provides a rich card-by-card curation workspace where the user edits, generates permutations, converts to cloze, and adds individual cards to decks.

- **Feature name**: Forge
- **Route**: `/forge`
- **Layout**: Full-screen takeover (no sidebar). Back button to return to main app
- **Navigation**: Always visible in main nav (top-level item alongside decks/review)

---

## 2. Background: What Exists Today

### 2.1 Memoria (Chrome Extension) — Predecessor

Memoria is a Chrome extension (Plasmo, MV3) that generates Anki flashcards from documents and web content. It runs source material through a multi-stage LLM pipeline:

- **Pipeline**: Source → 16KB chunking → topic extraction → two-pass "pressure cooker" card generation → editing → Anki export
- **State**: XState v5 state machine (`memoriaRouter`) orchestrating all states and transitions
- **Effect**: Used for all async I/O with `Data.TaggedError` for typed errors
- **AI**: Vercel AI SDK v5, multi-provider (Claude, GPT, Gemini, Grok), 12 prompts each assignable to different models
- **Pressure Cooker**: Two-pass generation — Pass 1 uses extended thinking (20K budget tokens, temp 1.0, 30K max tokens) with a 4-phase protocol (Mining → Generation → Critique → Revision enforcing 6 principles with star ratings). Pass 2 extracts ≥3-star cards into clean JSON (temp 0.3)
- **Storage**: `chrome.storage.local` for machine snapshots keyed by `storageId`, `localStorage` for export buffers
- **Export**: AnkiConnect API (localhost:8765) + clipboard buffer

### 2.2 Re Desktop — Current State

The Re desktop app is an Electron + React application for spaced repetition with markdown-based deck files.

**Architecture:**

- Electron 38, React 19.2, TypeScript, Vite
- TanStack Router (hash history) for routing
- `@xstate/store` 3.9.2 for state management (factory functions + React context, NOT singletons)
- Effect 3.19.18, `@effect/platform` 0.94.5, `@effect/schema` 0.69.0
- `ai` SDK 6.0.97 with `@ai-sdk/anthropic` and `@ai-sdk/openai`
- `@effect/sql-sqlite-node` 0.49.0 for SQLite
- `electron-effect-rpc` 0.8.0 for type-safe IPC
- Tailwind CSS 4.1 + Base UI 1.2 for styling
- Tiptap for rich text editing

**Existing services (main process):**

- `DeckManager` — read/write/create/delete/rename markdown deck files with FSRS metadata
- `SecretStore` — encrypted API keys via Electron `safeStorage` (supports `openai-api-key`, `anthropic-api-key`)
- `AiClient` — streaming LLM completions via `ai.streamText()`, provider-agnostic `provider:model` format
- `SettingsRepository` — load/save workspace root path from `settings.json`
- `ReviewQueueBuilder` + `Scheduler` — FSRS scheduling
- `AnalyticsRepository` — SQLite review history with compensation intents
- `DeckWriteCoordinator` — per-deck semaphore for atomic file writes
- `AppEventPublisher` — event bus for cross-window communication
- `WorkspaceWatcher` — file system monitoring for deck changes

**Existing SQLite tables:**

- `workspaces` (id, canonical_root_path, created_at)
- `review_history` (id, workspace_id, reviewed_at, deck_relative_path, deck_path, card_id, grade, previous/next FSRS state fields, undone_at)

**Existing RPC contracts (30 methods, 1 stream, 4 events):**

- Workspace: `ScanDecks`, `GetWorkspaceSnapshot`, `CreateDeck`, `DeleteDeck`, `RenameDeck`, `SelectDirectory`
- Editor: `AppendItem`, `ReplaceItem`, `GetItemForEdit`, `CheckDuplicates`, `DeleteItems`, `OpenEditorWindow`
- Review: `BuildReviewQueue`, `GetCardContent`, `ScheduleReview`, `UndoReview`, `GetReviewStats`, `ListReviewHistory`
- Settings: `GetSettings`, `SetWorkspaceRootPath`
- Secrets: `HasApiKey`, `SetApiKey`, `DeleteApiKey`
- AI: `StreamCompletion` (stream RPC)
- Events: `WorkspaceSnapshotChanged`, `CardEdited`, `CardsDeleted`, `EditorNavigateRequest`

**Existing XState stores (5 total):**

- `workspaceStore` — workspace loading status + snapshot
- `deckListStore` — deck tree, selection, expansion state
- `deckSelectionStore` — multi-select map of deck paths
- `editorStore` — card editing state (mode, cardType, content, frozen fields, dirty, duplicates)
- `settingsStore` — settings modal visibility

**AI client interface:**

```typescript
interface AiClient {
  readonly streamCompletion: (input: {
    readonly model: string; // "anthropic:claude-opus-4" format
    readonly prompt: string;
    readonly systemPrompt?: string;
  }) => Stream.Stream<string, AiStreamError>;
}
```

Error types: `AiKeyMissingError`, `AiRateLimitError`, `AiOfflineError`, `AiCompletionError`, `AiProviderNotSupportedError`.

Model ID format validated by: `/^[a-z][\w-]*:.+$/` (e.g., `anthropic:claude-sonnet-4-5`).

---

## 3. What Forge Is NOT (Excluded from Memoria)

- **AnkiConnect export** — Re has its own deck storage; no Anki API
- **Export buffer / clipboard** — cards go directly to decks
- **Web content extraction** — not in MVP; PDF only
- **Pressure cooker two-pass system** — replaced with single-pass generation + user-driven quality
- **Quote field** — cards are Q&A only (question + answer), no supporting quote
- **Improve question/answer prompts** — not in first version
- **Augment quote** — no quotes in Re
- **Context cards** (add-context-card, add-context-cards) — not in first version
- **Create from instructions** — not in first version
- **Additional conceptual cards** — not in first version

---

## 4. Architecture

### 4.1 Main/Renderer Split

Forge decouples the pipeline work from the UI by splitting responsibilities across the Electron process boundary:

**Main process (Effect services):**

- PDF text extraction with page-boundary tracking
- Text chunking
- Topic extraction (LLM calls)
- Card generation (LLM calls)
- Permutation generation (LLM calls)
- Cloze conversion (LLM calls)
- Session persistence (SQLite CRUD)
- Adding cards to deck files (via existing `DeckManager.appendItem`)

**Renderer (UI + state machine):**

- Wizard step navigation
- Topic selection UI
- Card curation workspace
- Rich text editing (Tiptap)
- PDF viewer (toggleable)
- Permutation/cloze side panel
- Progress counters

The **database is the source of truth**, not the UI. The renderer reads state from the DB via RPC calls. This enables free navigation between wizard steps without data loss — going back to topic selection doesn't discard generated cards because they're persisted in SQLite.

### 4.2 Package Location

All Forge code lives inside `apps/desktop`:

```
apps/desktop/src/
├── main/forge/
│   ├── services/
│   │   ├── pdf-extractor.ts          # PdfExtractor service interface + live implementation
│   │   ├── chunk-service.ts          # ChunkService service interface + live implementation
│   │   ├── topic-extractor.ts        # TopicExtractor service interface + live implementation
│   │   ├── card-generator.ts         # CardGenerator service interface + live implementation
│   │   └── forge-session-repository.ts  # ForgeSessionRepository (SQLite CRUD)
│   ├── prompts/
│   │   ├── get-topics.ts             # Topic extraction prompt
│   │   ├── create-cards.ts           # Single-pass card generation prompt
│   │   ├── create-permutations.ts    # Basic permutation prompt
│   │   ├── create-cloze.ts           # Cloze conversion prompt
│   │   └── principles.ts             # Six flashcard design principles
│   ├── migrations/
│   │   └── 0002_create_forge_tables.ts  # SQLite migration
│   └── errors.ts                     # Forge-specific tagged errors
├── main/rpc/handlers/
│   └── forge.ts                      # Forge RPC handlers
├── main/di/
│   └── forge-services.ts             # DI service tags + layer constructors
├── shared/forge/
│   ├── contracts.ts                  # Forge RPC contract definitions (Schema-validated)
│   └── types.ts                      # Shared types (ForgeSession, ForgeChunk, ForgeTopic, ForgeCard)
├── shared/state/
│   └── forgeStore.ts                 # @xstate/store for forge UI state
└── renderer/src/
    ├── routes/forge/
    │   ├── index.tsx                 # Session list + "New Session" entry point
    │   ├── session.tsx               # Active session wrapper (loads session from DB)
    │   ├── steps/
    │   │   ├── source-upload.tsx     # Step 1: PDF upload + deck selection
    │   │   ├── topic-selection.tsx   # Step 2: Topic extraction + selection
    │   │   └── card-workspace.tsx    # Step 3: Card creation workspace
    │   └── components/
    │       ├── topic-sidebar.tsx     # Left sidebar with topic list + status badges
    │       ├── card-panel.tsx        # Main card display area
    │       ├── card-editor.tsx       # Individual card with Tiptap rich text editing
    │       ├── side-panel.tsx        # Permutations / cloze side panel
    │       ├── pdf-viewer.tsx        # Toggleable PDF page viewer
    │       ├── deck-selector.tsx     # Deck picker (existing + create new)
    │       └── session-list.tsx      # Paginated list of past sessions
    └── components/nav/
        └── (update existing nav to add Forge link)
```

### 4.3 Effect Service Interfaces

Each pipeline stage is a separate Effect service with an explicit interface, following the codebase pattern of `Context.GenericTag` + `Layer.effect`.

#### PdfExtractor

```typescript
interface PdfExtractorResult {
  readonly text: string;
  readonly pageBreaks: ReadonlyArray<{ readonly offset: number; readonly page: number }>;
  readonly sourceFingerprint: string;
}

interface PdfExtractor {
  readonly extractText: (filePath: string) => Effect.Effect<PdfExtractorResult, PdfExtractionError>;
}

const PdfExtractor = Context.GenericTag<PdfExtractor>("@re/desktop/forge/PdfExtractor");
```

Uses `pdf-parse` (Node native) wrapped behind the interface. Returns extracted text, page break positions, and a stable source fingerprint used for duplicate detection.

Fingerprint source: `PDFParse#getInfo().fingerprints` (pdf.js document fingerprint). Use the first non-null entry as the primary fingerprint. If both entries are null, derive a deterministic fallback hash from file bytes.

#### ChunkService

```typescript
interface ChunkResult {
  readonly chunks: ReadonlyArray<{
    readonly text: string;
    readonly sequenceOrder: number;
    readonly pageBreaks: ReadonlyArray<{ readonly offset: number; readonly page: number }>;
  }>;
}

interface ChunkService {
  readonly chunkText: (input: {
    readonly text: string;
    readonly pageBreaks: ReadonlyArray<{ readonly offset: number; readonly page: number }>;
    readonly chunkSize?: number;
  }) => Effect.Effect<ChunkResult, never>;
}

const ChunkService = Context.GenericTag<ChunkService>("@re/desktop/forge/ChunkService");
```

Splits text into 16KB character slices with zero overlap. Slices the `pageBreaks` array to produce per-chunk page boundary metadata (offsets adjusted to be chunk-relative).

#### TopicExtractor

```typescript
interface TopicExtractionResult {
  readonly topics: ReadonlyArray<string>;
}

interface TopicExtractor {
  readonly extractTopics: (input: {
    readonly chunkText: string;
    readonly model: string;
  }) => Effect.Effect<TopicExtractionResult, TopicExtractionError>;
}

const TopicExtractor = Context.GenericTag<TopicExtractor>("@re/desktop/forge/TopicExtractor");
```

Single LLM call per chunk. System prompt = chunk text. User prompt = instructions for extracting informative statements. Returns array of topic strings. Depends on `AiClient` (resolved from the existing AI service infrastructure — but note: this service needs non-streaming `generateText` rather than `streamText`, so the `AiClient` interface may need extension or a parallel `AiTextGenerator` service; see §4.5).

#### CardGenerator

```typescript
interface CardGenerationResult {
  readonly cards: ReadonlyArray<{
    readonly question: string;
    readonly answer: string;
  }>;
}

interface CardGenerator {
  readonly generateCards: (input: {
    readonly topic: string;
    readonly sourceText: string;
    readonly model: string;
  }) => Effect.Effect<CardGenerationResult, CardGenerationError>;

  readonly generatePermutations: (input: {
    readonly question: string;
    readonly answer: string;
    readonly model: string;
  }) => Effect.Effect<CardGenerationResult, CardGenerationError>;

  readonly generateCloze: (input: {
    readonly question: string;
    readonly answer: string;
    readonly model: string;
  }) => Effect.Effect<{ readonly cloze: string }, CardGenerationError>;
}

const CardGenerator = Context.GenericTag<CardGenerator>("@re/desktop/forge/CardGenerator");
```

`generateCards`: Single-pass LLM call per topic. System prompt = chunk source text. User prompt = topic + principles + JSON format instructions. Returns raw Q&A pairs.

`generatePermutations`: LLM call for a single card. Returns 5–10 Q&A variations.

`generateCloze`: LLM call to convert a Q&A pair into cloze format (`{{cN::text::hint}}`).

#### ForgeSessionRepository

```typescript
interface ForgeSessionRepository {
  readonly createSession: (input: {
    readonly sourceKind: "pdf" | "web";
    readonly sourceFilePath: string;
    readonly sourceFingerprint: string;
    readonly deckPath: string | null;
  }) => Effect.Effect<ForgeSession, ForgeSessionError>;

  readonly findBySourceFingerprint: (input: {
    readonly sourceKind: "pdf" | "web";
    readonly sourceFingerprint: string;
  }) => Effect.Effect<ForgeSession | null, ForgeSessionError>;

  readonly getSession: (sessionId: number) => Effect.Effect<ForgeSession, ForgeSessionNotFound>;

  readonly listSessions: (input: {
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<ReadonlyArray<ForgeSessionSummary>, ForgeSessionError>;

  readonly updateSessionStatus: (
    sessionId: number,
    status: ForgeSessionStatus,
  ) => Effect.Effect<void, ForgeSessionNotFound>;

  readonly updateSessionDeckPath: (
    sessionId: number,
    deckPath: string,
  ) => Effect.Effect<void, ForgeSessionNotFound>;

  readonly saveChunks: (
    sessionId: number,
    chunks: ReadonlyArray<{
      readonly text: string;
      readonly sequenceOrder: number;
      readonly pageBoundaries: ReadonlyArray<{ readonly offset: number; readonly page: number }>;
    }>,
  ) => Effect.Effect<ReadonlyArray<ForgeChunk>, ForgeSessionError>;

  readonly getChunks: (
    sessionId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeChunk>, ForgeSessionError>;

  readonly saveTopics: (
    chunkId: number,
    topics: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<ForgeTopic>, ForgeSessionError>;

  readonly getTopics: (
    sessionId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeTopic>, ForgeSessionError>;

  readonly updateTopicStatus: (
    topicId: number,
    status: ForgeTopicStatus,
  ) => Effect.Effect<void, ForgeTopicNotFound>;

  readonly updateTopicSelection: (
    topicId: number,
    selected: boolean,
  ) => Effect.Effect<void, ForgeTopicNotFound>;

  readonly saveCards: (
    topicId: number,
    cards: ReadonlyArray<{
      readonly question: string;
      readonly answer: string;
    }>,
  ) => Effect.Effect<ReadonlyArray<ForgeCard>, ForgeSessionError>;

  readonly getCards: (
    topicId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeCard>, ForgeSessionError>;

  readonly getCardsBySession: (
    sessionId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeCard & { topicId: number }>, ForgeSessionError>;

  readonly updateCard: (
    cardId: number,
    fields: {
      readonly question?: string;
      readonly answer?: string;
      readonly cardType?: ForgeCardType;
      readonly clozeContent?: string;
    },
  ) => Effect.Effect<void, ForgeCardNotFound>;

  readonly markCardAdded: (
    cardId: number,
    deckPath: string,
  ) => Effect.Effect<void, ForgeCardNotFound>;

  readonly deleteCard: (cardId: number) => Effect.Effect<void, ForgeCardNotFound>;

  readonly deleteUnsavedCards: (topicId: number) => Effect.Effect<void, ForgeSessionError>;
}

const ForgeSessionRepository = Context.GenericTag<ForgeSessionRepository>(
  "@re/desktop/forge/ForgeSessionRepository",
);
```

### 4.4 Error Types

All Forge errors use `Schema.TaggedError` consistent with the existing codebase:

```typescript
class PdfExtractionError extends Schema.TaggedError<PdfExtractionError>(
  "@re/desktop/forge/PdfExtractionError",
)("PdfExtractionError", {
  message: Schema.String,
}) {}

class TopicExtractionError extends Schema.TaggedError<TopicExtractionError>(
  "@re/desktop/forge/TopicExtractionError",
)("TopicExtractionError", {
  chunkId: Schema.Number,
  message: Schema.String,
}) {}

class CardGenerationError extends Schema.TaggedError<CardGenerationError>(
  "@re/desktop/forge/CardGenerationError",
)("CardGenerationError", {
  topicId: Schema.Number,
  message: Schema.String,
}) {}

class ForgeSessionError extends Schema.TaggedError<ForgeSessionError>(
  "@re/desktop/forge/ForgeSessionError",
)("ForgeSessionError", {
  message: Schema.String,
}) {}

class ForgeSessionNotFound extends Schema.TaggedError<ForgeSessionNotFound>(
  "@re/desktop/forge/ForgeSessionNotFound",
)("ForgeSessionNotFound", {
  sessionId: Schema.Number,
}) {}

class ForgeTopicNotFound extends Schema.TaggedError<ForgeTopicNotFound>(
  "@re/desktop/forge/ForgeTopicNotFound",
)("ForgeTopicNotFound", {
  topicId: Schema.Number,
}) {}

class ForgeCardNotFound extends Schema.TaggedError<ForgeCardNotFound>(
  "@re/desktop/forge/ForgeCardNotFound",
)("ForgeCardNotFound", {
  cardId: Schema.Number,
}) {}
```

### 4.5 AiClient Extension

The existing `AiClient` only exposes `streamCompletion` (returns `Stream<string, AiStreamError>`). Forge's pipeline stages (topic extraction, card generation, permutations, cloze) need non-streaming `generateText` that returns structured JSON responses. Two options:

**Option A: Extend AiClient** — Add a `generateText` method to the existing interface:

```typescript
interface AiClient {
  readonly streamCompletion: (...) => Stream.Stream<string, AiStreamError>;
  readonly generateText: (input: {
    readonly model: string;
    readonly prompt: string;
    readonly systemPrompt?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
  }) => Effect.Effect<string, AiGenerateError>;
}
```

**Option B: Separate AiTextGenerator service** — Keep `AiClient` for streaming, add a new service for non-streaming:

```typescript
interface AiTextGenerator {
  readonly generateText: (input: {
    readonly model: string;
    readonly prompt: string;
    readonly systemPrompt?: string;
    readonly temperature?: number;
    readonly maxTokens?: number;
  }) => Effect.Effect<string, AiGenerateError>;
}
```

Option A is simpler since both use the same secret store and provider configuration. The implementation wraps `ai.generateText()` instead of `ai.streamText()`, with the same provider resolution and error mapping logic.

---

## 5. SQLite Schema

New migration: `0002_create_forge_tables`

Following the existing migration pattern (`MIGRATION_KEY_PATTERN = /^(\d{4})_[a-z0-9_]+$/`):

```sql
CREATE TABLE IF NOT EXISTS forge_sessions (
  id INTEGER PRIMARY KEY,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('pdf', 'web')),
  source_file_path TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  -- Generic source fingerprint used for duplicate detection across source types
  -- (e.g. PDF fingerprint, URL/content hash for web sources later)
  deck_path TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'extracting', 'extracted', 'topics_extracting', 'topics_extracted', 'generating', 'ready', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS forge_sessions_created_idx
  ON forge_sessions(created_at DESC);

CREATE INDEX IF NOT EXISTS forge_sessions_status_idx
  ON forge_sessions(status);

CREATE INDEX IF NOT EXISTS forge_sessions_source_kind_fingerprint_idx
  ON forge_sessions(source_kind, source_fingerprint);


CREATE TABLE IF NOT EXISTS forge_chunks (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES forge_sessions(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sequence_order INTEGER NOT NULL,
  page_boundaries TEXT NOT NULL DEFAULT '[]',
  -- JSON array: [{ "offset": 0, "page": 1 }, { "offset": 4200, "page": 2 }]
  -- Each entry marks the character offset within this chunk where a new page starts
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS forge_chunks_session_idx
  ON forge_chunks(session_id, sequence_order);


CREATE TABLE IF NOT EXISTS forge_topics (
  id INTEGER PRIMARY KEY,
  chunk_id INTEGER NOT NULL REFERENCES forge_chunks(id) ON DELETE CASCADE,
  topic_text TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating', 'generated', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS forge_topics_chunk_idx
  ON forge_topics(chunk_id);

CREATE INDEX IF NOT EXISTS forge_topics_selected_status_idx
  ON forge_topics(selected, status);


CREATE TABLE IF NOT EXISTS forge_cards (
  id INTEGER PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES forge_topics(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'qa'
    CHECK (card_type IN ('qa', 'cloze')),
  cloze_content TEXT,
  -- For cloze cards: stores the cloze-formatted text e.g. "{{c1::mitochondria::organelle}} produces ATP"
  -- NULL for qa cards
  is_permutation INTEGER NOT NULL DEFAULT 0,
  -- 1 if this card was generated as a permutation of another card
  parent_card_id INTEGER REFERENCES forge_cards(id) ON DELETE SET NULL,
  -- The card this permutation was generated from (NULL for original cards)
  added_to_deck_path TEXT,
  -- NULL = not yet added to a deck. Set to deck file path when added
  added_at TEXT,
  -- ISO timestamp of when the card was added to a deck
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS forge_cards_topic_idx
  ON forge_cards(topic_id);

CREATE INDEX IF NOT EXISTS forge_cards_added_idx
  ON forge_cards(added_to_deck_path)
  WHERE added_to_deck_path IS NOT NULL;
```

**Session status flow:**

```
created → extracting → extracted → topics_extracting → topics_extracted → generating → ready
                 ↘ error                    ↘ error                          ↘ error
```

`ready` means the session has at least some generated cards and the user can interact with the card workspace. The session can cycle back through `generating` as the user triggers generation for additional topics.

**Page boundary data structure** (stored as JSON in `forge_chunks.page_boundaries`):

```json
[
  { "offset": 0, "page": 1 },
  { "offset": 4200, "page": 2 },
  { "offset": 12800, "page": 3 }
]
```

This means: characters 0–4199 come from page 1, 4200–12799 from page 2, 12800+ from page 3. The PDF viewer uses this to determine which page to display when a topic (which belongs to a chunk) is selected.

---

## 6. RPC Contracts

New Forge-specific RPC methods following the existing `electron-effect-rpc` contract pattern with `Schema.Struct` for input/output validation.

### 6.1 Session Management

```typescript
// Create a new forge session from a PDF file
ForgeCreateSession = rpc(
  "ForgeCreateSession",
  Schema.Struct({
    sourceFilePath: Schema.String,
    deckPath: Schema.NullOr(Schema.String),
  }),
  ForgeSessionSchema,
  ForgeSessionErrorSchema,
);

// List past sessions (paginated)
ForgeListSessions = rpc(
  "ForgeListSessions",
  Schema.Struct({
    limit: Schema.Number,
    offset: Schema.Number,
  }),
  Schema.Struct({
    sessions: Schema.Array(ForgeSessionSummarySchema),
    total: Schema.Number,
  }),
  ForgeSessionErrorSchema,
);

// Load a full session (session + chunks + topics + cards)
ForgeGetSession = rpc(
  "ForgeGetSession",
  Schema.Struct({ sessionId: Schema.Number }),
  ForgeFullSessionSchema,
  Schema.Union(ForgeSessionNotFoundSchema, ForgeSessionErrorSchema),
);

// Update the target deck for a session
ForgeUpdateDeckPath = rpc(
  "ForgeUpdateDeckPath",
  Schema.Struct({
    sessionId: Schema.Number,
    deckPath: Schema.String,
  }),
  Schema.Void,
  ForgeSessionNotFoundSchema,
);

// Open a file dialog and return the selected PDF path
ForgeSelectPdfFile = rpc(
  "ForgeSelectPdfFile",
  Schema.Struct({}),
  Schema.NullOr(Schema.String), // null if user cancelled
  Schema.Never,
);
```

`ForgeCreateSession` is PDF-specific and sets `source_kind = 'pdf'`. The handler computes `source_fingerprint` via `pdf-parse` `getInfo().fingerprints` (first non-null entry) before session creation, then checks `ForgeSessionRepository.findBySourceFingerprint({ sourceKind: "pdf", sourceFingerprint })` for possible duplicates.

### 6.2 Pipeline Stages

```typescript
// Extract text from the session's PDF and create chunks
// This is a compound operation: extract → chunk → persist to DB
ForgeExtractAndChunk = rpc(
  "ForgeExtractAndChunk",
  Schema.Struct({ sessionId: Schema.Number }),
  Schema.Struct({
    chunks: Schema.Array(ForgeChunkSchema),
    totalPages: Schema.Number,
  }),
  Schema.Union(ForgeSessionNotFoundSchema, PdfExtractionErrorSchema),
);

// Extract topics from all chunks in a session
// Returns immediately — topics are extracted in the background
// Progress tracked via ForgeTopicExtractionProgress event
ForgeExtractTopics = rpc(
  "ForgeExtractTopics",
  Schema.Struct({
    sessionId: Schema.Number,
    model: ModelIdSchema,
  }),
  Schema.Void,
  Schema.Union(ForgeSessionNotFoundSchema, ForgeSessionErrorSchema),
);

// Toggle topic selection
ForgeToggleTopicSelection = rpc(
  "ForgeToggleTopicSelection",
  Schema.Struct({
    topicId: Schema.Number,
    selected: Schema.Boolean,
  }),
  Schema.Void,
  ForgeTopicNotFoundSchema,
);

// Batch-select/deselect topics
ForgeBatchToggleTopics = rpc(
  "ForgeBatchToggleTopics",
  Schema.Struct({
    topicIds: Schema.Array(Schema.Number),
    selected: Schema.Boolean,
  }),
  Schema.Void,
  ForgeSessionErrorSchema,
);

// Generate cards for specific topics
// Bounded concurrency. Replaces unadded cards for topics that already have cards
ForgeGenerateCards = rpc(
  "ForgeGenerateCards",
  Schema.Struct({
    topicIds: Schema.Array(Schema.Number),
    model: ModelIdSchema,
  }),
  Schema.Void, // Results arrive via events
  Schema.Union(ForgeSessionErrorSchema, ForgeTopicNotFoundSchema),
);
```

### 6.3 Card Operations

```typescript
// Update a card's content (rich text editing)
ForgeUpdateCard = rpc(
  "ForgeUpdateCard",
  Schema.Struct({
    cardId: Schema.Number,
    question: Schema.optional(Schema.String),
    answer: Schema.optional(Schema.String),
  }),
  Schema.Void,
  ForgeCardNotFoundSchema,
);

// Delete a card
ForgeDeleteCard = rpc(
  "ForgeDeleteCard",
  Schema.Struct({ cardId: Schema.Number }),
  Schema.Void,
  ForgeCardNotFoundSchema,
);

// Add a card to a deck (creates the card in the deck file with fresh FSRS metadata)
ForgeAddCardToDeck = rpc(
  "ForgeAddCardToDeck",
  Schema.Struct({
    cardId: Schema.Number,
    deckPath: Schema.String,
  }),
  Schema.Void,
  Schema.Union(ForgeCardNotFoundSchema, ForgeAddToDeckErrorSchema),
);

// Generate permutations for a card
ForgeGeneratePermutations = rpc(
  "ForgeGeneratePermutations",
  Schema.Struct({
    cardId: Schema.Number,
    model: ModelIdSchema,
  }),
  Schema.Struct({
    cards: Schema.Array(ForgeCardSchema),
  }),
  Schema.Union(ForgeCardNotFoundSchema, CardGenerationErrorSchema),
);

// Convert a card to cloze format
ForgeGenerateCloze = rpc(
  "ForgeGenerateCloze",
  Schema.Struct({
    cardId: Schema.Number,
    model: ModelIdSchema,
  }),
  Schema.Struct({
    card: ForgeCardSchema,
  }),
  Schema.Union(ForgeCardNotFoundSchema, CardGenerationErrorSchema),
);
```

### 6.4 Events

```typescript
// Topic extraction progress (fired per-chunk as topics are extracted)
ForgeTopicExtractionProgress = event(
  "ForgeTopicExtractionProgress",
  Schema.Struct({
    sessionId: Schema.Number,
    chunkId: Schema.Number,
    completedChunks: Schema.Number,
    totalChunks: Schema.Number,
    topics: Schema.Array(ForgeTopicSchema), // newly extracted topics for this chunk
  }),
);

// Card generation progress (fired per-topic as cards are generated)
ForgeCardGenerationProgress = event(
  "ForgeCardGenerationProgress",
  Schema.Struct({
    topicId: Schema.Number,
    status: Schema.Literal("generating", "generated", "error"),
    cards: Schema.optional(Schema.Array(ForgeCardSchema)),
    errorMessage: Schema.optional(Schema.String),
  }),
);

// Topic extraction completed for a session
ForgeTopicExtractionComplete = event(
  "ForgeTopicExtractionComplete",
  Schema.Struct({
    sessionId: Schema.Number,
    totalTopics: Schema.Number,
  }),
);
```

### 6.5 Shared Schema Types

```typescript
const ForgeSessionStatusSchema = Schema.Literal(
  "created",
  "extracting",
  "extracted",
  "topics_extracting",
  "topics_extracted",
  "generating",
  "ready",
  "error",
);

const ForgeSourceKindSchema = Schema.Literal("pdf", "web");

const ForgeTopicStatusSchema = Schema.Literal("pending", "generating", "generated", "error");

const ForgeCardTypeSchema = Schema.Literal("qa", "cloze");

const ForgeSessionSummarySchema = Schema.Struct({
  id: Schema.Number,
  sourceKind: ForgeSourceKindSchema,
  sourceFilePath: Schema.String,
  status: ForgeSessionStatusSchema,
  deckPath: Schema.NullOr(Schema.String),
  totalTopics: Schema.Number,
  totalCards: Schema.Number,
  addedCards: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const ForgeChunkSchema = Schema.Struct({
  id: Schema.Number,
  sessionId: Schema.Number,
  text: Schema.String,
  sequenceOrder: Schema.Number,
  pageBoundaries: Schema.Array(
    Schema.Struct({
      offset: Schema.Number,
      page: Schema.Number,
    }),
  ),
});

const ForgeTopicSchema = Schema.Struct({
  id: Schema.Number,
  chunkId: Schema.Number,
  topicText: Schema.String,
  selected: Schema.Boolean,
  status: ForgeTopicStatusSchema,
  errorMessage: Schema.NullOr(Schema.String),
});

const ForgeCardSchema = Schema.Struct({
  id: Schema.Number,
  topicId: Schema.Number,
  question: Schema.String,
  answer: Schema.String,
  cardType: ForgeCardTypeSchema,
  clozeContent: Schema.NullOr(Schema.String),
  isPermutation: Schema.Boolean,
  parentCardId: Schema.NullOr(Schema.Number),
  addedToDeckPath: Schema.NullOr(Schema.String),
  addedAt: Schema.NullOr(Schema.String),
});

const ForgeFullSessionSchema = Schema.Struct({
  session: ForgeSessionSummarySchema,
  chunks: Schema.Array(
    Schema.Struct({
      ...ForgeChunkSchema.fields,
      topics: Schema.Array(
        Schema.Struct({
          ...ForgeTopicSchema.fields,
          cards: Schema.Array(ForgeCardSchema),
        }),
      ),
    }),
  ),
});
```

---

## 7. Prompts

### 7.1 get-topics

Extracts informative statements from a text chunk. Each statement is a self-contained sentence expressing one main idea.

**System prompt**: The raw chunk text (leverages Anthropic prompt caching for repeated calls across chunks from the same source).

**User prompt**:

```
Analyze the provided text and generate a series of informative statements that capture its key points and progression. Each statement should:

1. Be a single, clear sentence expressing one main idea or event from the text, including relevant context.
2. Provide enough detail to stand alone while still connecting to the broader narrative.
3. Follow the text's original structure and flow of information.
4. Be specific and concrete, avoiding abstract generalizations.
5. Include relevant dates, names, and other contextual information when present in the original text.
6. Exclude mentions of the author or the text itself.

Ensure your summary:
- Covers the entire text without omitting significant content.
- Maintains the original sequence of ideas and events.
- Uses declarative sentences that are informative and contextually rich.
- Allows someone to understand the main points and context of the original text from these statements alone.

Format your response as a JSON object with the following structure:

{
  "topics": [
    "<topic>",
    "<topic>",
    ...
  ]
}

Do not include any other text or explanations in your response, just the JSON object, otherwise your response will be rejected.
Do not wrap it in markdown code blocks, just return the JSON object.
```

**Model settings**: Temperature 1.0, default max tokens.

**Output parsing**: Extract JSON, use `jsonrepair` for common LLM JSON issues, validate `{ topics: string[] }` shape.

### 7.2 create-cards (Single-Pass)

This is the **new** single-pass prompt replacing the pressure cooker. The LLM generates cards directly with the 6 principles embedded as guidelines. No self-critique pass — quality is user-driven.

**System prompt**: The chunk source text.

**User prompt** (includes embedded principles):

```
Create flashcards about the following statement from the provided text. Each flashcard must be a question-answer pair following these six design principles:

**CONTEXT-INDEPENDENCE**: Every question must be fully self-contained. Include all necessary context — full names, dates, locations, relevant background. No pronouns without antecedents. A knowledgeable person unfamiliar with the source text should be able to answer correctly.

**COVERTNESS**: The question must not hint at, constrain toward, or phonetically echo the answer. No root echoes, no overconstrained descriptions, no leading syntax.

**FOCUS**: Each card tests exactly one discrete fact or relationship. Answers must be statable in ≤15 words without conjunction. No compound questions, no answers requiring enumeration of >3 items.

**PRECISION**: Use full names, specific dates, and explicit identifiers. No "during the war" (which war?), no "the president" (which president?), no vague temporal references.

**TRACTABILITY**: Cards should be answerable after 3–5 study exposures. No verbatim recall of >20 words. No arbitrary lists of >5 items. Break down complex facts.

**GRANULARITY**: Complex information must be split across multiple cards, not compressed into one. "What were three causes of X?" should become 3+ separate cards. Prefer many small cards over few heavy ones.

Additional rules:
- No yes/no or true/false questions
- Prompts must always be questions, not statements
- Never reference the source material, author, or text
- Keep answers short, clear, and direct — preferably ≤15 words, maximum two sentences
- For numerical answers: "Approximately X (exact: Y)"
- For mathematics: use LaTeX in <anki-mathjax> tags
- For code: use <code> HTML tags

Create flashcards specifically and exclusively about the following statement:
"{topic}"

Do not create cards about related concepts or broader contexts unless directly and explicitly mentioned in this statement.

Provide your response in JSON format:
{
  "flashcards": [
    { "question": "...", "answer": "..." },
    ...
  ]
}

Do not include any other text or explanations, just the JSON object.
Do not wrap it in markdown code blocks.
```

**Model settings**: Temperature 1.0, default max tokens.

**Output parsing**: Extract JSON, validate `{ flashcards: Array<{ question: string, answer: string }> }`.

### 7.3 create-permutations

Generates 5–10 variations of a Q&A card to prevent pattern matching in spaced repetition.

**User prompt**:

```
Generate multiple variations of the following flashcard. Each permutation should test the same core knowledge from a different angle.

Original flashcard:
Question: {question}
Answer: {answer}

Create variations by:
a. Changing key elements (subject, object, relationship)
b. Reversing the question-answer format
c. Altering perspective or context
d. Using different levels of specificity
e. Introducing negatives or opposites
f. Varying linguistic structure

Guidelines:
- Each variation must require genuine recall, not pattern matching
- No two questions or answers should be phrased similarly
- Every answer must stand alone and be fully self-contained
- Include enough context in each question for independent comprehension
- Keep answers ≤15 words, concise and direct
- Generate 5–10 variations

{principles}

Provide your response in JSON format:
{
  "flashcards": [
    { "question": "...", "answer": "..." },
    ...
  ]
}

Do not include any other text or explanations, just the JSON object.
Do not wrap it in markdown code blocks.
```

Where `{principles}` is the full six-principles text from `principles.ts`.

**Model settings**: Temperature 1.0.

### 7.4 create-cloze

Converts a Q&A pair into cloze deletion format.

**User prompt**:

```
Convert the following flashcard into a cloze deletion card.

Question: {question}
Answer: {answer}

Instructions:
1. Combine the question and answer into a single coherent statement
2. Identify all key pieces of information: names, dates, numbers, terms, concepts
3. Create cloze deletions using the format {{cN::text::hint}} for each key piece
4. Each cloze captures distinct critical information
5. Hints should provide clear clues for recalling the hidden information
6. Ensure cloze deletions fully encompass all significant details

Example format:
{{c1::Yersinia pestis::bacterium}} caused the {{c2::Black Death::14th century pandemic}}, killing approximately {{c3::one-third::fraction}} of Europe's population.

Provide your response in JSON format:
{
  "cloze": "The full cloze text with {{cN::...::...}} deletions"
}

Do not include any other text or explanations, just the JSON object.
Do not wrap it in markdown code blocks.
```

**Model settings**: Temperature 0.3 (more deterministic for formatting).

---

## 8. UX Flow

### 8.1 Entry Point: `/forge`

When the user navigates to `/forge`, they see:

- A **paginated list of past sessions** showing: source filename, creation date, status, card counts (total generated / added to deck)
- A **"New Session"** button that starts the wizard at Step 1
- Clicking a past session opens it at the appropriate step based on its status

### 8.2 Step 1: Source Upload

- **File input area**: Drag-and-drop zone + "Browse" button (triggers `ForgeSelectPdfFile` → Electron's `dialog.showOpenDialog` with PDF filter)
- **Deck selector**: Dropdown of existing decks (from `GetWorkspaceSnapshot`) + text input to type a new deck name (creates via `CreateDeck` on save). Pre-selected if the user entered Forge from a deck context. Changeable at any time throughout the wizard
- On file selection: computes PDF fingerprint via `pdf-parse`, checks for existing sessions with matching `(source_kind, source_fingerprint)`, then calls `ForgeCreateSession` → `ForgeExtractAndChunk`. Shows extraction progress
- After extraction: displays chunk count, page count, total text length as a summary. "Continue" button to Step 2

### 8.3 Step 2: Topic Extraction & Selection

- On entry: calls `ForgeExtractTopics`. Progress counter shows "Extracting topics from chunk 3/12..."
- As topics arrive via `ForgeTopicExtractionProgress` events, they appear grouped by chunk
- Each topic is a checkbox row with the informative statement text
- **All topics unselected by default** (opt-in). User checks the topics they want cards for
- "Select All" / "Deselect All" per chunk, and globally
- "Continue" button enabled when ≥1 topic selected. Calls `ForgeBatchToggleTopics` to persist selections

### 8.4 Step 3: Card Creation Workspace

This is the main workspace where the user spends most of their time.

**Layout (3 columns + optional PDF):**

```
┌────────────────┬──────────────────────────────┬─────────────────────┐
│  Topic Sidebar │       Card Panel             │    Side Panel       │
│                │                              │  (on demand)        │
│ ● Topic 1 (3) │  ┌─────────────────────────┐ │                     │
│ ○ Topic 2     │  │ Card 1          [Added] │ │  Permutations:      │
│ ◉ Topic 3 ... │  │ Q: What is...          │ │  ┌─────────────────┐│
│ ✕ Topic 4 err │  │ A: The process...      │ │  │ Perm 1 [Add]    ││
│ ● Topic 5 (2) │  │ [Add] [Perm] [Cloze]   │ │  │ Perm 2 [Add]    ││
│                │  │ [Delete]                │ │  │ Perm 3 [Add]    ││
│                │  ├─────────────────────────┤ │  └─────────────────┘│
│ [Generate ▶]   │  │ Card 2                  │ │                     │
│                │  │ Q: Which...             │ │                     │
│                │  │ A: The...               │ │                     │
│                │  │ [Add] [Perm] [Cloze]   │ │                     │
│                │  │ [Delete]                │ │                     │
│                │  └─────────────────────────┘ │                     │
└────────────────┴──────────────────────────────┴─────────────────────┘
│  [Toggle PDF Viewer]                                                │
├─────────────────────────────────────────────────────────────────────┤
│  PDF Viewer (toggleable)                                            │
│  Shows page N based on selected topic's chunk page boundaries       │
└─────────────────────────────────────────────────────────────────────┘
```

**Topic Sidebar:**

- Lists all selected topics (from Step 2)
- Status badges per topic:
  - `○` Empty — no cards generated yet
  - `◉` Generating — spinner, LLM call in progress
  - `● (N)` Has cards — shows card count
  - `✓ (N)` All added — all cards have been added to a deck (checkmark)
  - `✕` Error — generation failed, retry available
- Clicking a topic loads its cards into the Card Panel
- **"Generate" button** at the bottom: triggers `ForgeGenerateCards` for all selected topics in the sidebar that don't have cards yet
- Multi-select in sidebar to generate for specific topics

**Auto-generation on entry**: When the user first arrives at Step 3, `ForgeGenerateCards` is automatically called for the first 3 selected topics (by sequence order). The rest wait for manual triggering.

**Card Panel:**

- Shows cards for the currently selected topic
- Each card rendered with **Tiptap rich text editor** — fully rendered markdown but editable inline
- Question and answer are separate editable fields
- Per-card action buttons:
  - **Add to deck**: Calls `ForgeAddCardToDeck` → internally calls `DeckManager.appendItem` with fresh FSRS metadata. Card gets "Added" badge, stays visible
  - **Permutations**: Opens side panel with `ForgeGeneratePermutations` results. Each permutation is independently addable
  - **Cloze**: Opens side panel with `ForgeGenerateCloze` result. The cloze card is independently addable
  - **Delete**: Calls `ForgeDeleteCard`. Card removed from view
- Cards already added to a deck show an "Added" badge and their action buttons are dimmed (except delete)

**Regeneration behavior**: If the user triggers "Generate" for a topic that already has cards:

- Cards already added to a deck are preserved (not deleted)
- Cards NOT yet added are deleted and replaced with new generation results
- This is implemented via `ForgeDeleteUnsavedCards(topicId)` + `ForgeGenerateCards([topicId])`

**Side Panel (Permutations / Cloze):**

- Opens to the right when user clicks "Perm" or "Cloze" on a card
- Shows the original card for reference at the top
- Below: generated permutations or cloze card
- Each result has its own "Add to deck" button
- Permutation cards are stored in `forge_cards` with `is_permutation = 1` and `parent_card_id` pointing to the source card
- Cloze cards are stored with `card_type = 'cloze'` and `cloze_content` populated

**PDF Viewer (toggleable):**

- Toggle button at bottom of the workspace
- When open, renders the PDF page corresponding to the selected topic's chunk
- Page determined by: topic → chunk → `page_boundaries` → first page in that chunk's range
- Uses the `source_file_path` from the session to load the PDF

---

## 9. State Management (Renderer)

The Forge UI uses a combination of `@xstate/store` for local UI state and RPC calls + event subscriptions for data.

### 9.1 ForgeStore

```typescript
const createForgeStore = () =>
  createStore({
    context: {
      currentSessionId: null as number | null,
      currentStep: "sessions" as "sessions" | "upload" | "topics" | "workspace",
      selectedTopicId: null as number | null,
      sidePanelOpen: false,
      sidePanelMode: null as "permutations" | "cloze" | null,
      sidePanelCardId: null as number | null,
      pdfViewerOpen: false,
      topicExtractionProgress: null as { completed: number; total: number } | null,
      generatingTopicIds: [] as number[],
    },
    on: {
      setSession: (context, event: { sessionId: number; step: string }) => ({
        ...context,
        currentSessionId: event.sessionId,
        currentStep: event.step,
      }),
      setStep: (context, event: { step: string }) => ({
        ...context,
        currentStep: event.step,
      }),
      selectTopic: (context, event: { topicId: number }) => ({
        ...context,
        selectedTopicId: event.topicId,
        sidePanelOpen: false,
        sidePanelMode: null,
        sidePanelCardId: null,
      }),
      openSidePanel: (context, event: { mode: string; cardId: number }) => ({
        ...context,
        sidePanelOpen: true,
        sidePanelMode: event.mode,
        sidePanelCardId: event.cardId,
      }),
      closeSidePanel: (context) => ({
        ...context,
        sidePanelOpen: false,
        sidePanelMode: null,
        sidePanelCardId: null,
      }),
      togglePdfViewer: (context) => ({
        ...context,
        pdfViewerOpen: !context.pdfViewerOpen,
      }),
      setTopicExtractionProgress: (context, event: { completed: number; total: number }) => ({
        ...context,
        topicExtractionProgress: { completed: event.completed, total: event.total },
      }),
      clearTopicExtractionProgress: (context) => ({
        ...context,
        topicExtractionProgress: null,
      }),
      addGeneratingTopic: (context, event: { topicId: number }) => ({
        ...context,
        generatingTopicIds: [...context.generatingTopicIds, event.topicId],
      }),
      removeGeneratingTopic: (context, event: { topicId: number }) => ({
        ...context,
        generatingTopicIds: context.generatingTopicIds.filter((id) => id !== event.topicId),
      }),
    },
  });
```

### 9.2 Data Fetching

Session data (chunks, topics, cards) is fetched via RPC and held in React component state or TanStack Query cache. The store only manages UI coordination state (which step, which topic selected, which panel open).

When events arrive (`ForgeTopicExtractionProgress`, `ForgeCardGenerationProgress`), they update both the store (for progress indicators) and trigger re-fetches of the relevant data.

---

## 10. AI Model Configuration

### 10.1 Forge Prompts

Four prompts for MVP, each independently configurable:

| Prompt Key           | Description                           | Default Model                 |
| -------------------- | ------------------------------------- | ----------------------------- |
| `forge-topics`       | Topic extraction from chunk           | `anthropic:claude-sonnet-4-5` |
| `forge-cards`        | Single-pass card generation per topic | `anthropic:claude-sonnet-4-5` |
| `forge-permutations` | Basic Q&A permutations                | `anthropic:claude-haiku-4-5`  |
| `forge-cloze`        | Cloze conversion                      | `anthropic:claude-haiku-4-5`  |

### 10.2 Settings Storage

Per-prompt model assignments stored in `settings.json` under a `forge.prompts` key:

```json
{
  "workspace": { "rootPath": "/path/to/workspace" },
  "forge": {
    "prompts": {
      "forge-topics": "anthropic:claude-sonnet-4-5",
      "forge-cards": "anthropic:claude-sonnet-4-5",
      "forge-permutations": "anthropic:claude-haiku-4-5",
      "forge-cloze": "anthropic:claude-haiku-4-5"
    },
    "concurrency": 3
  }
}
```

The `concurrency` setting controls the max number of parallel LLM calls during topic extraction and card generation (default: 3).

This requires extending `SettingsRepository` to read/write the `forge` section, and extending the `GetSettings` / `SetSettings` RPC (or adding `ForgeGetSettings` / `ForgeSetSettings`).

---

## 11. Adding Cards to Decks

When the user clicks "Add to deck" on a card in the Forge workspace:

1. **RPC**: `ForgeAddCardToDeck({ cardId, deckPath })` is called
2. **Main process handler**:
   a. Reads the `ForgeCard` from SQLite
   b. Formats it into Re's card format:
   - **Q&A**: `question\n---\nanswer` (same separator as the existing editor)
   - **Cloze**: The `cloze_content` field directly
     c. Calls `DeckWriteCoordinator.withDeckLock(deckPath, ...)` to ensure atomicity
     d. Calls `DeckManager.appendItem(deckPath, formattedContent, cardType)` — this adds the card to the end of the deck file with fresh FSRS metadata (new nanoid, state=New, stability/difficulty defaults)
     e. Updates `forge_cards` row: sets `added_to_deck_path` and `added_at`
     f. Publishes `CardEdited` event so the main window's deck view updates
3. **Renderer**: Card gets "Added" badge in the UI

For **permutation cards**: Same flow. They have their own `forge_cards` row with `is_permutation = 1`. Each permutation is independently addable.

For **cloze cards**: The `cloze_content` field contains the formatted cloze text (e.g., `{{c1::mitochondria::organelle}} produces ATP`). This is passed to `appendItem` with `cardType = "cloze"`.

---

## 12. Concurrency Model

### 12.1 Topic Extraction

When `ForgeExtractTopics` is called:

- Fetches all chunks for the session
- Processes chunks using `Effect.forEach` with `{ concurrency: N }` where N = `forge.concurrency` from settings (default 3)
- Each chunk: calls `TopicExtractor.extractTopics(chunkText, model)`
- On success: saves topics to `forge_topics` via `ForgeSessionRepository.saveTopics(chunkId, topics)`
- Publishes `ForgeTopicExtractionProgress` event after each chunk completes
- On completion: updates session status to `topics_extracted`, publishes `ForgeTopicExtractionComplete`
- Per-chunk error resilience: failed chunks are logged, other chunks continue

### 12.2 Card Generation

When `ForgeGenerateCards` is called with a list of topic IDs:

- For each topic that already has unadded cards: calls `ForgeSessionRepository.deleteUnsavedCards(topicId)` first
- Updates each topic status to `generating`
- Processes topics using `Effect.forEach` with `{ concurrency: N }`
- Each topic: calls `CardGenerator.generateCards(topic, sourceText, model)`
- On success: saves cards to `forge_cards` via `ForgeSessionRepository.saveCards(topicId, cards)`, updates topic status to `generated`
- Publishes `ForgeCardGenerationProgress` event per topic
- Per-topic error resilience: failed topics get status `error` with `error_message`. Other topics continue

### 12.3 Auto-Generation

On entering Step 3 for the first time in a session:

- Takes the first 3 selected topics (by chunk sequence order, then topic order within chunk)
- Calls `ForgeGenerateCards` with those 3 topic IDs
- Remaining topics show as "Empty" in the sidebar, awaiting manual trigger

---

## 13. Open Design Work

These items need resolution before or during implementation:

1. **AiClient extension**: Decide between extending the existing `AiClient` interface with `generateText` vs. creating a separate `AiTextGenerator` service. The existing `AiClient` only has `streamCompletion`
2. **PDF viewer component**: Research and select a React PDF viewer component that can render specific pages from a file path. Candidates: `react-pdf` (uses pdfjs-dist), `@react-pdf-viewer/core`
3. **Settings UI for Forge prompts**: Where to add the per-prompt model selection UI. Could be a section in the existing settings modal, or a settings panel within the Forge view itself
4. **JSON parsing robustness**: Port or reimplement Memoria's `jsonrepair`-based JSON extraction for LLM responses that may be wrapped in markdown code blocks or contain syntax errors
5. **SettingsRepository extension**: The current `SettingsRepository` only handles `workspace.rootPath`. Needs extension for `forge.prompts` and `forge.concurrency`
6. **Drag-and-drop IPC**: Design the IPC flow for when a user drops a PDF onto the renderer window — the file path needs to reach the main process. Electron's `webUtils.getPathForFile()` in the renderer preload may handle this
7. **Rich text card editing**: How Tiptap integrates in the Forge card editor. The existing editor uses Tiptap for deck card editing — may be reusable
8. **Migration ordering**: Ensure the new `0002_create_forge_tables` migration runs after `0001_create_review_history` and integrates with the existing migration validation system
