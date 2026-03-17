# @re/desktop

Electron desktop app for **re**, a spaced repetition flashcard system backed by plain markdown files. The app provides deck management, FSRS-based review sessions, an AI card generation pipeline (Forge), a rich card editor, and review analytics. It sits on top of `@re/core` (card format) and `@re/workspace` (workspace scanning), with an Effect-based main process and a React renderer connected through typed IPC contracts.

## Features

- **Deck browser** — scan a workspace directory for `.md` deck files, browse a nested folder/deck tree with due/new counts and parse error surfacing
- **Review sessions** — FSRS scheduling, keyboard-first grading, undo, session progress and summary, AI-generated answer permutations for Q/A cards
- **Forge** — AI card generation pipeline: PDF or pasted text → chunk preview → topic extraction → card generation → inline editing and cloze derivation → save to deck
- **Card editor** — Tiptap-based markdown editor with math (KaTeX), code blocks, cloze shortcuts, image imports, and duplicate detection. Opens in a dedicated window
- **Settings** — workspace root configuration, AI provider API keys (Anthropic, OpenAI, Google)
- **Git sync** — workspace-level status and one-click pull/push from the top bar
- **Analytics** — per-card review history stored in SQLite with compensation-based crash resilience

## Routes

| Route       | Purpose                                   |
| ----------- | ----------------------------------------- |
| `/`         | Home — deck list and review entry         |
| `/review`   | Active review session                     |
| `/forge`    | AI source-to-cards workflow               |
| `/editor`   | Card editor (typically a separate window) |
| `/settings` | Workspace and secrets settings            |

## Tech stack

| Area          | Technology                                               |
| ------------- | -------------------------------------------------------- |
| Desktop shell | Electron 38, Electron Forge 7.8, Vite 7                  |
| Renderer      | React 19, TanStack Router (hash history), TanStack Query |
| UI state      | `@xstate/store` via context-injected factories           |
| Styling       | Tailwind CSS 4, Base UI, Lucide icons                    |
| Editor        | Tiptap 3, KaTeX, highlight.js                            |
| Main process  | Effect, `electron-effect-rpc` (typed IPC)                |
| AI            | Vercel AI SDK (Anthropic, OpenAI, Google providers)      |
| Database      | better-sqlite3 via `@effect/sql`                         |
| Testing       | Vitest 4 (jsdom + Playwright/Chromium browser mode)      |

## Project structure

```
src/
├── main/                        # Electron main process
│   ├── index.ts                 # App bootstrap, windows, DI wiring, IPC startup
│   ├── di/                      # Effect service definitions and layers
│   │   ├── services/            # Service tags (one file per service)
│   │   └── layers/              # Composed Layer bundles
│   ├── rpc/                     # Typed IPC handlers
│   │   └── handlers/            # Per-domain handlers (workspace, review, forge, editor, …)
│   ├── forge/                   # Forge pipeline
│   │   ├── prompts/             # LLM prompt templates and registry
│   │   └── services/            # PDF extraction, chunking, session persistence
│   ├── analytics/               # Review analytics SQLite repo, migrations, compensation
│   ├── ai/                      # AI client factory and provider resolution
│   ├── settings/                # Settings repository (JSON file)
│   ├── secrets/                 # Encrypted secret store
│   ├── watcher/                 # Workspace file watcher and event publication
│   ├── git/                     # Git sync service
│   └── sqlite/                  # Runtime boundary helpers (runSqlInRuntime)
├── preload/                     # Context-isolated bridge
│   └── index.ts                 # Exposes desktopApi (invoke/subscribe) and desktopHost
├── renderer/src/                # React renderer
│   ├── main.tsx                 # App entry — providers, router mount
│   ├── routes/                  # TanStack Router file-based routes
│   ├── components/              # UI components by domain
│   │   ├── deck-list/           # Deck browsing, selection, metrics
│   │   ├── review-session/      # Card display, grading, progress, summary
│   │   ├── forge/               # Source canvas, topic selection, card editing
│   │   ├── editor/              # Tiptap editor, extensions, deck combobox
│   │   ├── settings/            # Settings sections and provider key management
│   │   └── ui/                  # Base UI primitives (button, dialog, checkbox, …)
│   ├── hooks/                   # TanStack Query hooks and mutations
│   ├── machines/                # XState machines (review, editor workflows)
│   └── lib/                     # Router, query client, IPC helpers, query keys
└── shared/                      # Code shared across main and renderer
    ├── rpc/                     # IPC contracts and schemas
    ├── state/                   # Store factories and StoresProvider context
    ├── settings/                # Settings types, errors, mappers
    ├── secrets/                 # Secret types, errors, mappers
    └── lib/                     # Shared utilities
```

`test/` mirrors the `src/` structure, with shared renderer helpers in `test/renderer/render-with-providers.tsx`.

## Getting started

| Requirement | Notes                                                |
| ----------- | ---------------------------------------------------- |
| Node        | `>=22.0.0 <25.0.0`                                   |
| Bun         | Monorepo package manager                             |
| Chromium    | For browser tests: `npx playwright install chromium` |

```bash
bun install                  # from monorepo root
cd apps/desktop
bun run dev                  # Electron with Vite HMR
```

### Build and package

```bash
bun run build                # electron-forge package (unpackaged app bundle)
bun run package              # electron-forge make (platform installers: ZIP, DEB, RPM, Squirrel)
```

### Other scripts

```bash
bun run typecheck            # tsc --noEmit
bun run lint                 # oxlint
bun run kill                 # Force-kill stale Electron processes
```

## Testing

Vitest 4 with two projects:

| Project   | Environment                    | File pattern                 | Purpose                           |
| --------- | ------------------------------ | ---------------------------- | --------------------------------- |
| `unit`    | jsdom                          | `test/**/*.test.ts(x)`       | Logic, stores, hooks, components  |
| `browser` | Playwright (headless Chromium) | `test/**/*.browser.test.tsx` | Component tests in a real browser |

```bash
bun run test                 # Run all tests (both projects)
bun run test:watch           # Watch mode
bun run test:e2e             # Playwright E2E tests (separate config)
```

Browser tests use `vitest-browser-react` for rendering and `expect.element()` for assertions. See `CLAUDE.md` for browser test gotchas (Base UI inert overlays, disabled element clicks, substring matching).

## Architecture notes

### IPC boundary

Main process services are implemented with Effect (typed errors, dependency injection via Layers). The renderer communicates through typed RPC contracts in `src/shared/rpc/contracts/`. On the renderer side, `runIpcEffect` (`lib/ipc-query.ts`) bridges Effect results into Promises for TanStack Query hooks. Domain errors are mapped before crossing the boundary — React code never inspects `unknown`.

### XState stores

UI state uses `@xstate/store` factory functions injected via React context (`StoresProvider`), not module-scoped singletons. Each test gets a fresh store instance via `createStores()`.

### SQLite runtime boundary

Repository methods that depend on `@effect/sql`'s `SqlClient` use helpers from `src/main/sqlite/runtime-runner.ts` to bridge the Effect runtime while preserving typed domain errors. Public repository APIs stay `R = never`.

### Query key centralization

All TanStack Query keys live in `lib/query-keys.ts`. IPC event subscriptions and mutations update cache through these same key factories. One canonical hook per server resource prevents key drift and duplicate cache entries.

### Security model

Both main and editor windows run with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. All privileged access goes through the preload bridge and typed IPC.

## Card format

This app reads and writes the markdown card format defined by `@re/core`. See the [repo root README](../../README.md) for the format specification.
