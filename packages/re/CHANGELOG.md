# @simbyotic/re

## 0.3.0-rc.0

### Minor Changes

- Migrate all five library entry points to Effect `4.0.0-rc.112`. Consumers must share that exact Effect peer and replace `@effect/platform` imports with Effect core modules; Node workspace consumers supply a matching v4 adapter. Schema codecs and validation causes, service keys, and the `Result` returned by `reconcileCards` now expose v4 types. See [the migration guide](docs/migrating-effect-v4.md) for consumer changes. Markdown data, stable card identities, and FSRS scheduling behavior are preserved. Desktop, Raycast, and Overlay continue to use their frozen Effect v3 archive.
- ab7ba23: Add `composeQA` with field-specific validation and CRLF normalization, and shared built-in review preparation and grading functions. Preparation returns resolved content snapshots and typed issues, applying limits after invalid cards are skipped. Grading revalidates card identity and schedules current metadata under the deck lock.

  Give missing-deck and missing-card errors useful default messages and export shared deck error formatters. Built-in resolution now exposes the `qa`/`cloze` card type union while preserving the existing key annotation API.

- 480fdd3: Expose shared card authoring and review services through `@simbyotic/re/study`, including field validation, image insertion, safe review edits, deletion, and grade/delete undo. Let clients supply their Markdown transform so native and Raycast renderers share persistence behavior without sharing rendering code.

## 0.2.0

### Minor Changes

- Consolidate the four libraries into one package with `core`, `item-types`, `scheduler`, and `workspace` subpath exports. Replace the four `@simbyotic/re-*` dependencies with `@simbyotic/re` and update imports, for example from `@simbyotic/re-core` to `@simbyotic/re/core`. Existing module APIs are preserved. Workspace consumers must also install `@effect/platform`; it is an optional peer so other entry points can be used without it.
