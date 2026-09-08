# @simbyotic/re

Markdown flashcards, built-in Q&A and cloze item types, FSRS scheduling, and Effect workspace services in one package.

```bash
npm install @simbyotic/re effect
```

Choose the entry points your application needs:

```ts
import { createMetadata, parseFile, serializeFile } from "@simbyotic/re/core";
import { QAType, ClozeType } from "@simbyotic/re/item-types";
import { Scheduler, SchedulerLive } from "@simbyotic/re/scheduler";
import { DeckManager, DeckManagerLive } from "@simbyotic/re/workspace";
import { ReviewStore, makeReviewStoreLive } from "@simbyotic/re/study";
```

Each entry point exposes its own ESM JavaScript and TypeScript declarations. There is no root barrel export: importing core or scheduling does not load workspace services. Declaration maps and TypeScript sources are included for editor navigation. Native CommonJS `require` works on Node versions that support synchronous ESM loading, including Node 24.

| Entry point                | Purpose                                                                 | API guide                        |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| `@simbyotic/re/core`       | Markdown parsing, serialization, metadata, and item-type contracts      | [Core](docs/core.md)             |
| `@simbyotic/re/item-types` | Built-in Q&A and cloze parsers and card generation                      | [Item types](docs/item-types.md) |
| `@simbyotic/re/scheduler`  | FSRS scheduling, independent of workspace storage                       | [Scheduler](docs/scheduler.md)   |
| `@simbyotic/re/workspace`  | Deck persistence, discovery, image assets, snapshots, and review queues | [Workspace](docs/workspace.md)   |
| `@simbyotic/re/study` | Card authoring, image insertion, and review sessions with edit/delete/undo | [Study](docs/study.md) |

## Workspace services

Workspace consumers also install `@effect/platform` and supply filesystem and path layers. For Node applications:

```bash
npm install @simbyotic/re effect @effect/platform @effect/platform-node
```

`effect` is a shared peer dependency. `@effect/platform` is an optional peer because the workspace and study entry points require it. Core, item types, and scheduling work without a platform installation. All entry points share one package version and one dependency entry in your application.

## Development

The source modules remain separate under `src/core`, `src/item-types`, `src/scheduler`, `src/workspace`, and `src/study`. Core has no dependency on the other modules; item types and scheduling depend on core; workspace depends on core, item types, and scheduling; study builds on those services. Internal imports are relative, so the package has no dependency on separately published re libraries.

From the repository root:

```bash
bun run build:library
bun run --filter '@simbyotic/re' test
bun run --filter '@simbyotic/re' typecheck
bun run check:packages
```
