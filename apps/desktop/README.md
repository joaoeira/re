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

All RPC handlers share one `DeckManager`, which owns deck mutation locks. Handlers must not
wrap rename in another lock: `renameDeck` already acquires both paths and handles same-path
renames. `GitSyncCoordinator` guards only Git's commit and integration phases; it does not
block deck saves or compensation reads. Sync excludes temporary deck files from staging and
requires a retry when the workspace changes during fetch. Handler tests use the real Git
coordinator by default.

## Getting started

Use Node 24 and npm. From the standalone repository:

```bash
npm ci
npm run dev
```

The standalone export includes `vendor/` library archives and a portable npm lockfile.
It does not require this monorepo or published `@re/*` packages. Installing dependencies
also installs Electron and builds the native SQLite binding; macOS may require Xcode
Command Line Tools if a prebuilt binding is unavailable.

### Build and package

```bash
npm run build                # application bundle in out/
npm run package              # platform installers in out/make/
```

On macOS, packaging produces a ZIP and DMG with local ad hoc signing. Release signing
and notarization require separate distribution configuration. The included GitHub Actions
workflow checks the app on macOS and uploads installers.

### Install the latest local build on macOS

```bash
npm run install:local
```

This command builds, verifies, installs, relaunches, and health-checks the desktop app.
The build, package, and install commands automatically select a compatible installed Node
version. The installer validates code signing and Electron ASAR integrity, then checks
that the installed payload matches the fresh build. The previous app is retained under
`out/install-backups/`. If the new app fails its launch check, the installer restores
and relaunches the previous version.

### Monorepo development and extraction

While the app remains in this monorepo, use `bun run desktop:dev`, `desktop:test`,
`desktop:typecheck`, `desktop:build`, `desktop:package`, or `desktop:install` from the root.
These wrappers build the shared libraries before invoking the app's own commands.
Run `bun run watch:libraries` alongside development when editing library source.

`bun run check:desktop` installs an isolated copy outside the workspace, verifies native
SQLite, runs unit and browser tests, builds platform installers, and smoke-tests the packaged payload. To retain a standalone
copy with source, library archives, lockfile, CI, and build outputs:

```bash
bun run check:desktop --output dist/desktop
```

The destination must not exist. The export is ready to become a separate repository.
When the shared libraries are published, replace the `file:vendor/...` dependencies
with their released versions and regenerate the npm lockfile.

## Testing

Vitest 4 with two projects:

| Project   | Environment                    | File pattern                 | Purpose                           |
| --------- | ------------------------------ | ---------------------------- | --------------------------------- |
| `unit`    | jsdom                          | `test/**/*.test.ts(x)`       | Logic, stores, hooks, components  |
| `browser` | Playwright (headless Chromium) | `test/**/*.browser.test.tsx` | Component tests in a real browser |

```bash
npm test                     # Run all tests (both projects)
npm run test:watch           # Watch mode
npm run test:e2e             # Packaged payload smoke test; run build/package first
```

The smoke test runs the packaged payload under the development Electron host so Playwright
can connect without changing the shipped executable’s security fuses. It uses temporary user
data and checks renderer startup, settings IPC, and SQLite initialization.

Browser tests use `vitest-browser-react` for rendering and `expect.element()` for assertions. Run `npx playwright install chromium` before running browser tests. Run tests before packaging: Forge rebuilds SQLite for Electron, whereas Vitest uses Node. Run `npm rebuild better-sqlite3` to restore the Node binding after packaging.

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

This app reads and writes the markdown card format defined by `@re/core`. The installed `@re/core` package includes the card format documentation in its README.
