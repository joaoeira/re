# Desktop Main Process Effect DI Migration Plan

## Decision and Intent

This migration moves desktop main-process wiring from positional constructor-style dependency passing to an explicit Effect dependency graph. The objective is architectural consistency with existing Effect-centric domain code in `packages/workspace`, without breaking Electron startup order, RPC runtime assumptions, or test ergonomics.

The key design choice is to adopt Effect DI for the shell, but to do it with strict migration invariants so intermediate states stay executable.

## Issues Explicitly Addressed in This Revision

This revision closes the concrete gaps that made the prior draft risky to execute.

1. Startup-cycle feasibility is now handled as a prerequisite seam-extraction phase with bridge services before DI cutover.
2. Duplicate-index invalidation is now a first-class service boundary, instead of implicit coupling from workspace to editor closure state.
3. Handler `R`-channel migration risk is constrained by an explicit invariant to keep exported handlers at `R = never` until a synchronized runtime migration exists.
4. Local `provide` removal is now ordered after composition-root cutover, not before it.
5. Test migration now has a concrete override contract and explicit one-to-one mapping from existing override use sites.

## Sources and Evidence Base

This plan is based on both Effect documentation and repository-specific constraints.

### Effect documentation

- Managing Services: https://effect.website/docs/requirements-management/services/
- Managing Layers: https://effect.website/docs/requirements-management/layers/
- API references consulted:
  - `Effect.Service`
  - `Effect.Tag`
  - `Context.Tag`
  - `Context.GenericTag`
- Local Effect guidance:
  - `effect-solutions list`
  - `effect-solutions show services-and-layers`
  - `~/.local/share/effect-solutions/effect`

### Repository-specific constraints

- Startup cycle and proxy wiring:
  - `apps/desktop/src/main/index.ts:221`
  - `apps/desktop/src/main/index.ts:227`
  - `apps/desktop/src/main/index.ts:236`
  - `apps/desktop/src/main/index.ts:254`
  - `apps/desktop/src/main/index.ts:257`
- Handler fan-out and editor/workspace coupling:
  - `apps/desktop/src/main/rpc/handlers.ts:30`
  - `apps/desktop/src/main/rpc/handlers.ts:52`
  - `apps/desktop/src/main/rpc/handlers/workspace.ts:21`
  - `apps/desktop/src/main/rpc/handlers/editor.ts:162`
  - `apps/desktop/src/main/rpc/handlers/editor.ts:170`
- RPC handler requirement typing model:
  - `node_modules/electron-effect-rpc/dist/types.d.ts:6`
  - `node_modules/electron-effect-rpc/dist/types.d.ts:7`
  - `node_modules/electron-effect-rpc/dist/kit.d.ts:24`
  - `node_modules/electron-effect-rpc/dist/kit.d.ts:27`
- Current test override surface:
  - `apps/desktop/test/main/rpc-handlers/helpers.ts:38`
  - `apps/desktop/test/main/rpc-handlers/helpers.ts:44`

## What Constructor Injection Means Here

In this codebase, "constructor injection" is function-parameter injection at composition root: build concrete dependencies in `index.ts`, pass them into `createAppRpcHandlers(...)`, then into sub-handler factories. The pattern is explicit and workable, but dependency visibility is procedural (follow call chains) instead of type-level (`R` / layer graph).

## Why Effect DI Is Still the Better Direction

Effect DI gives stronger dependency transparency, better composition locality, and cleaner substitution for tests. That benefit is already visible in `packages/workspace` where tags/layers are first-class.

The important nuance is not "use Context.Tag everywhere." For app services with clear live constructors, `Effect.Service` is usually the better default because it bundles tag and live layer ergonomics. For runtime-bound values with no meaningful default (for example, publish callbacks that only exist after startup wiring), use `Context.GenericTag`.

## Non-Negotiable Migration Invariants

These invariants make the migration executable and prevent dead-end intermediate states.

1. Exported RPC handlers remain `Implementations<AppContract, never>` until an explicit runtime migration phase is introduced and completed.
2. Runtime behavior remains unchanged during DI migration phases; only wiring changes.
3. Startup cycle-breaking behavior remains explicit and tested at all times.
4. Existing test override capabilities are preserved one-to-one before removing old helper APIs.
5. Local `Effect.provide(...)` removal does not happen before replacement boundary provisioning exists.

The first invariant exists because `electron-effect-rpc` handler and runtime options are parameterized by the same `R`; migrating to non-`never` handlers requires synchronized runtime changes, not isolated handler edits.

## Current Hard Problems To Solve First

### 1) Startup dependency cycles

Current startup uses mutable proxies intentionally. Any DI migration that ignores this will stall.

- `watcherProxy` delegates to `watcher?` before watcher exists.
- `publishProxy` dereferences `ipcHandle!` before `ipcHandle` is set.
- `createAppRpcHandlers(...)` runs before watcher creation.
- watcher publish callback calls `rpc.markDuplicateIndexDirty()`.

### 2) Duplicate-index invalidation coupling

Editor owns duplicate-index cache state and invalidation, but workspace and watcher flows trigger invalidation through `markDuplicateIndexDirty`. This coupling must become an explicit service contract before handler factory migration.

### 3) Test harness coupling to positional overrides

`createHandlers(...)` currently exposes positional override injection for watcher/publish/open-editor/analytics/coordinator. Migration must preserve this flexibility through a named override contract before deleting compatibility paths.

## Target Architecture

The end state is a layered application graph with one composition root for handler construction and explicit service boundaries.

### Service style matrix

- `Effect.Service` for constructible app services with live implementations.
- `Context.GenericTag` for runtime-bound values that cannot have stable defaults at module load.

Planned services/modules under `apps/desktop/src/main/di/services/`:

- `SettingsRepositoryService` (`Effect.Service`)
- `AnalyticsRepositoryService` (`Effect.Service`)
- `DeckWriteCoordinatorService` (`Effect.Service` or plain tag + layer)
- `WorkspaceWatcherControlService` (`Context.GenericTag` for start/stop bridge)
- `AppEventPublisherService` (`Context.GenericTag` for publish bridge)
- `EditorWindowManagerService` (`Context.GenericTag` for runtime-created manager)
- `DuplicateIndexInvalidationService` (explicit contract extracted from editor cache concerns)
- `AppRpcHandlersService` (`Effect.Service` producing `{ handlers, markDuplicateIndexDirty }`)

Layer composition entrypoint:

- `apps/desktop/src/main/di/layers/main-live.ts`

## Phase Plan (Execution-Safe)

### Phase 0: Guardrails and parity baseline

Goal: establish hard checks before changing architecture.

Changes:

- Add a parity test asserting old path and DI path produce equivalent handler behavior for a representative subset.
- Add a migration invariant doc comment in `handlers.ts` that exported handlers remain `R = never` until runtime migration phase.

Files:

- `apps/desktop/test/main/rpc-handlers/*`
- `apps/desktop/src/main/rpc/handlers.ts`

Done criteria:

- Baseline tests green.
- Explicit invariant encoded in code comments and plan.

### Phase 1: Extract cycle-breaking and invalidation seams (prerequisite)

Goal: isolate the two coupling points that block safe handler DI.

Changes:

- Extract duplicate-index invalidation contract from editor handler internals into `DuplicateIndexInvalidationService`.
- Introduce startup bridge services for publish and watcher control, with late binding semantics.

Notes:

- This phase can keep existing non-DI constructor paths fully intact.
- Behavior must remain identical.

Files (new/modified):

- `apps/desktop/src/main/di/services/DuplicateIndexInvalidationService.ts`
- `apps/desktop/src/main/di/services/AppEventPublisherService.ts`
- `apps/desktop/src/main/di/services/WorkspaceWatcherControlService.ts`
- `apps/desktop/src/main/rpc/handlers/editor.ts`
- `apps/desktop/src/main/rpc/handlers/workspace.ts`
- `apps/desktop/src/main/index.ts` (bridge wiring only, no DI conversion yet)

Done criteria:

- Workspace invalidation no longer depends on editor closure internals directly.
- Bridge services can be bound after creation and are covered by tests.

### Phase 2: Add DI scaffolding modules without runtime cutover

Goal: define service modules and layer composition while preserving old call paths.

Changes:

- Add DI service modules and a preliminary `MainAppLive` composition.
- No production cutover yet.

Files:

- `apps/desktop/src/main/di/services/*.ts`
- `apps/desktop/src/main/di/layers/main-live.ts`
- `apps/desktop/src/main/di/index.ts`

Done criteria:

- Typecheck passes.
- No runtime behavior change.

### Phase 3: Migrate `createAppRpcHandlers` to DI-backed constructor with compatibility wrapper

Goal: switch handler assembly internals to service acquisition while preserving external API.

Changes:

- Add `makeAppRpcHandlersEffect` that acquires dependencies via services/tags.
- Keep existing `createAppRpcHandlers(...)` as compatibility adapter.
- Adapter provides needed services and returns same shape as before.

Critical invariant:

- Resulting `handlers` remain `Implementations<AppContract, never>`.

Files:

- `apps/desktop/src/main/rpc/handlers.ts`

Done criteria:

- Existing tests using `createAppRpcHandlers(...)` still pass.
- New DI constructor path has dedicated parity test.

### Phase 4: Migrate sub-handlers one by one to context-driven construction

Goal: remove positional service arguments from workspace/review/editor handlers incrementally.

Changes:

- `workspace.ts`: consume settings + watcher control + invalidation service from context.
- `review.ts`: consume settings + analytics + coordinator from context.
- `editor.ts`: consume publish/open-editor/coordinator/settings + duplicate-index invalidation service from context.
- Keep temporary wrappers so call sites remain stable.

Files:

- `apps/desktop/src/main/rpc/handlers/workspace.ts`
- `apps/desktop/src/main/rpc/handlers/review.ts`
- `apps/desktop/src/main/rpc/handlers/editor.ts`

Done criteria:

- No positional service args in final constructors.
- Tests pass with both compatibility and DI paths.

### Phase 5: Cut over `index.ts` to DI composition root

Goal: move main startup wiring to effectful composition while preserving Electron lifecycle ordering.

Changes:

- Keep lifecycle ownership in `index.ts` (`whenReady`, window creation, menu, IPC start/stop).
- Build runtime-bound bridge values, bind them in startup order.
- Materialize `AppRpcHandlersService` from composed layers.

Important detail:

- Maintain current safe ordering semantics (window creation before relevant calls, ipc handle assignment before publish use, watcher assignment before start/stop use).

Files:

- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/di/layers/main-live.ts`

Done criteria:

- App boots and IPC behavior is unchanged.
- Startup cycle behavior remains correct and tested.

### Phase 6: Remove local provisioning only after replacement boundaries exist

Goal: eliminate local `Effect.provide(...)` in handlers when equivalent provisioning is already in layer composition.

Changes:

- Remove local provisioning from handlers/shared helpers only after Phase 5 cutover.

Verification command:

- `rg "Effect\.provide\(" apps/desktop/src/main/rpc/handlers`

Policy:

- Allowlist only genuine boundaries; reject incidental local provisioning.

Files:

- `apps/desktop/src/main/rpc/handlers/*.ts`
- `apps/desktop/src/main/rpc/handlers/shared.ts`

Done criteria:

- Handler modules are mostly dependency-declaration-only; provisioning centralized.

### Phase 7: Test harness migration to layer overrides (with compatibility path)

Goal: preserve and then improve current test override ergonomics.

Changes:

- Introduce named-override helper API (layer-first) in `helpers.ts`.
- Keep positional helper signature as adapter during migration.

Target helper contract:

```ts
type HandlerTestOverrides = {
  watcher?: WorkspaceWatcher;
  publish?: IpcMainHandle<AppContract>["publish"];
  openEditorWindow?: (params: EditorWindowParams) => void;
  analyticsRepository?: ReviewAnalyticsRepository;
  deckWriteCoordinator?: DeckWriteCoordinator;
  settingsRepository?: SettingsRepository;
};
```

Files:

- `apps/desktop/test/main/rpc-handlers/helpers.ts`
- all rpc handler tests under `apps/desktop/test/main/rpc-handlers`

Done criteria:

- Every current positional override use has equivalent named override path.
- Compatibility adapter still passes.

### Phase 8: Remove compatibility adapters and finalize architecture

Goal: finish the migration and delete transitional plumbing.

Changes:

- Remove old positional constructor wrappers.
- Remove positional test helper adapter.
- Finalize service/layer naming conventions.

Done criteria:

- No deprecated wrappers referenced.
- Main process DI is consistent and explicit.

## Detailed Test Migration Plan

The migration must preserve current behavior coverage while changing wiring APIs.

### Current override usage that must map one-to-one

- watcher override: `apps/desktop/test/main/rpc-handlers/workspace.test.ts:257`
- analytics override: `apps/desktop/test/main/rpc-handlers/review.test.ts:402`
- publish override: `apps/desktop/test/main/rpc-handlers/editor.test.ts:25`
- open-editor override: `apps/desktop/test/main/rpc-handlers/editor.test.ts:567`
- coordinator override: `apps/desktop/test/main/rpc-handlers/deck-write-coordinator.integration.test.ts:20`

### Files requiring explicit migration work

- `apps/desktop/test/main/rpc-handlers/helpers.ts`
- `apps/desktop/test/main/rpc-handlers/workspace.test.ts`
- `apps/desktop/test/main/rpc-handlers/review.test.ts`
- `apps/desktop/test/main/rpc-handlers/editor.test.ts`
- `apps/desktop/test/main/rpc-handlers/deck-write-coordinator.integration.test.ts`

### Additional tests to add

- Startup cycle bridge test: publish and watcher bridges behave safely before/after binding.
- Duplicate invalidation propagation test: workspace/watcher-triggered updates invalidate duplicate cache via explicit service.
- Wrapper parity test: compatibility constructor output matches DI-native constructor behavior for representative methods.

## Risks and Mitigations

The biggest technical risk is phase-order breakage: removing local provisioning or positional dependencies before the replacement context/layer boundary is alive. The mitigation is the strict phase order above, especially making seam extraction and bridge services explicit prerequisites.

The biggest product risk is subtle behavior drift in editor duplicate detection and workspace watcher behavior. The mitigation is to extract invalidation contract first, then pin behavior with dedicated regression tests before DI rewiring.

The biggest test risk is losing override ergonomics and making tests slower or harder to reason about. The mitigation is a named override contract in helpers with a temporary adapter so migration is mechanical, not disruptive.

## Suggested PR Sequence

1. Phase 0 + Phase 1 (guardrails, seam extraction, bridge services).
2. Phase 2 + Phase 3 (DI scaffolding, handler assembler DI path + compatibility wrapper).
3. Phase 4 (sub-handler migrations in separate PRs: workspace, review, editor).
4. Phase 5 (index.ts composition root cutover).
5. Phase 6 (local provide consolidation).
6. Phase 7 (test helper and tests migration).
7. Phase 8 (adapter cleanup).

## Acceptance Criteria

Migration is complete when all are true:

1. Desktop main-process dependency graph is explicit in services/layers.
2. Startup cycle handling is explicit and tested (no hidden proxy assumptions).
3. Exported RPC handler behavior is unchanged, including error shapes.
4. Tests use layer/named overrides and preserve all prior override scenarios.
5. Local provisioning in handlers is removed except approved boundary cases.
6. Positional constructor wrappers are removed.
