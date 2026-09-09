# @simbyotic/re

Markdown flashcards, built-in Q&A and cloze item types, FSRS scheduling, and Effect workspace services in one package.

The `0.3.0-rc.0` library targets exactly Effect `4.0.0-rc.112`. Install the locally
validated archive with its shared peer:

```bash
npm install ./simbyotic-re-0.3.0-rc.0.tgz effect@4.0.0-rc.112
```

The archive is produced by `bun run pack:library` in `dist/packages/` at the
repository root. This prerelease has not been published by the migration;
the repository's public prerelease publishing route is not implemented.
See [Migrating to Effect v4](docs/migrating-effect-v4.md) for consumer changes.

Choose the entry points your application needs:

```ts
import { createMetadata, parseFile, serializeFile } from "@simbyotic/re/core";
import { QAType, ClozeType } from "@simbyotic/re/item-types";
import { Scheduler, SchedulerLive } from "@simbyotic/re/scheduler";
import { DeckManager, DeckManagerLive } from "@simbyotic/re/workspace";
import { ReviewStore, makeReviewStoreLive } from "@simbyotic/re/study";
```

Each entry point exposes its own ESM JavaScript and TypeScript declarations. There is no root barrel export: importing core or scheduling does not load workspace services. Declaration maps and TypeScript sources are included for editor navigation. Native ESM and CommonJS `require` are validated on Node 22 and 24 versions supporting synchronous ESM loading.

| Entry point                | Purpose                                                                    | API guide                        |
| -------------------------- | -------------------------------------------------------------------------- | -------------------------------- |
| `@simbyotic/re/core`       | Markdown parsing, serialization, metadata, and item-type contracts         | [Core](docs/core.md)             |
| `@simbyotic/re/item-types` | Built-in Q&A and cloze parsers and card generation                         | [Item types](docs/item-types.md) |
| `@simbyotic/re/scheduler`  | FSRS scheduling, independent of workspace storage                          | [Scheduler](docs/scheduler.md)   |
| `@simbyotic/re/workspace`  | Deck persistence, discovery, image assets, snapshots, and review queues    | [Workspace](docs/workspace.md)   |
| `@simbyotic/re/study`      | Card authoring, image insertion, and review sessions with edit/delete/undo | [Study](docs/study.md)           |

## Workspace services

Workspace and study consumers supply filesystem and path layers. These abstractions
now live in `effect/FileSystem` and `effect/Path`. For Node applications, add the matching adapter:

```bash
npm install @effect/platform-node@4.0.0-rc.112
```

`effect` is the only shared peer dependency. The old `@effect/platform` peer has been
removed. Core, item types, and scheduling work without installing a Node adapter.
All five entry points share one package version and one Effect installation in a consumer.

Desktop, Raycast, and Overlay remain on a separately frozen Effect v3 compatibility
line. Their archive pins do not follow this library's version. Markdown files,
card identities, and FSRS scheduling behavior are unchanged by the migration.

## Development

The source modules remain separate under `src/core`, `src/item-types`, `src/scheduler`, `src/workspace`, and `src/study`. Core has no dependency on the other modules; item types and scheduling depend on core; workspace depends on core, item types, and scheduling; study builds on those services. Internal imports are relative, so the package has no dependency on separately published re libraries.

From the repository root:

```bash
bun run build:library
bun run --filter '@simbyotic/re' test
bun run --filter '@simbyotic/re' typecheck
bun run check:packages
```
