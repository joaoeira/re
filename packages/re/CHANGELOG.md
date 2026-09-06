# @simbyotic/re

## 0.2.0

### Minor Changes

- Consolidate the four libraries into one package with `core`, `item-types`, `scheduler`, and `workspace` subpath exports. Replace the four `@simbyotic/re-*` dependencies with `@simbyotic/re` and update imports, for example from `@simbyotic/re-core` to `@simbyotic/re/core`. Existing module APIs are preserved. Workspace consumers must also install `@effect/platform`; it is an optional peer so other entry points can be used without it.
