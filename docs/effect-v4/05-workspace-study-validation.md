# Step 5 — Workspace and study migration validation

Implemented against Effect `4.0.0-rc.112`, Vitest `4.1.11`, and TypeScript
`5.9.3` on 2026-09-09, starting from `78e21ec`. Changes are confined to the
library's workspace/study source and tests, one benchmark error boundary, and
this report. Dependency manifests, the lockfile, app source, and frozen archives
are unchanged.

## Implemented contract

The eight workspace/study services use `Context.Service` with their existing
identifiers and explicit interfaces. Filesystem and path imports now come from
Effect core. Public store methods retain `R = never`; the review markdown
transform still requires `Path`, supplied by the review store. No Node adapter
or unstable module was added to library source.

Filesystem recovery uses typed `catchReason`/`catchReasons` handlers. Missing
files, permissions, exclusive-create collisions, rename failures, and image
deduplication retain their operation-specific policies. Domain errors from
special recovery branches are not rewrapped by fallback handlers. The
`Unknown`/`EINVAL` read-link exception inspects only the external OS cause inside
the typed `Unknown` handler. Mock filesystem methods now fail with wrapped v4
`PlatformError` values.

Each constructed deck manager owns its semaphore map. Lock creation is
synchronous, paths are resolved/deduplicated/sorted, and permits cover the
complete read/modify/write transaction and temporary-file cleanup. Waiting
remains interruptible; a started final rename remains uninterruptible. Locks
continue to coordinate only callers sharing the same manager, not independent
managers or other processes.

Queues and duplicate scanning use `Result`, retaining input order, duplicate
paths, concurrency limits, and failure containment. The v4 array APIs also
required adapting partition/filter callbacks and `Order.Number`/`Order.String`.
Shuffle tests now protect permutation multiplicity, unchanged input, seed
reproducibility, category grouping, and ordering before limits. They do not pin
the incidental v3 random sequence.

Review editing converts reconciliation through `Effect.fromResult` under the
deck lock. Grading, undo, deletion, authoring, image persistence, and callback
context/error behavior remain covered by the library-owned study suite. The
benchmark retains its formatted fatal message at the CLI boundary without
placing a global `Error` in the typed failure channel.

## Regression coverage

Six tests were added: read-link EINVAL versus unexpected OS failures; rename
NotFound with the source still present; bad image-write arguments; cancellation
during final rename; cancellation after acquiring part of a rename's lock set;
and grading through `ReviewStore` concurrently with appending through `DeckStore`.
The store-composition test uses one explicit manager layer shared by both stores.

The existing disappearing-source rename fixture was corrected: it previously
failed the initial stat and never reached rename. It now removes the source
inside the injected rename operation, then checks the public missing-file error.
Concurrency tests use Deferred gates, explicit fiber scheduling, and bounded
real-time timeouts. Real Node filesystem integration tests remain in the suite.

## Checks

| Check                                                                           | Result                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Full library build, including JavaScript, declarations, and declaration maps    | Passed                                                                   |
| Full library typecheck with repository diagnostics enabled                      | Passed                                                                   |
| Complete library test suite                                                     | 452 tests in 34 files passed                                             |
| Workspace/study subset                                                          | 195 tests in 17 files passed                                             |
| Library source, tests, and benchmark lint                                       | 80 files; no warnings or errors                                          |
| Changed-file formatting and diff whitespace                                     | Passed                                                                   |
| Emitted consumer, strict NodeNext and Bundler resolution, `skipLibCheck: false` | Passed                                                                   |
| Native Node `24.7.0` execution of emitted consumer                              | Passed                                                                   |
| Eleven deliberate faults in a disposable copy                                   | Each protected regression failed; restored checks passed                 |
| App resolution under Node and Bun                                               | Library resolves v4; all three apps resolve frozen v3                    |
| App-isolation and release-tool regressions                                      | 4 and 3 tests passed                                                     |
| Desktop, Raycast, and Overlay typechecks                                        | Passed                                                                   |
| Desktop tests                                                                   | 693 passed; 10 SQLite tests skipped by the existing native-binding probe |
| Raycast tests                                                                   | 40 passed                                                                |
| Overlay tests, including rendering                                              | 17 passed                                                                |

The emitted consumer uses copies of the freshly built files outside the
workspace and links the already installed dependencies. It checks all five
entry points and the public layer requirements, store-method service channels,
and grade error/undo types. Runtime checks capture the services first, then use
their methods without the service graph in context: deck discovery, authoring,
session creation, rendering, grading, editing, undo, deletion/restoration, image
persistence, snapshots, and typed load errors all pass. This is an emitted-file
consumer check, not the independently installed archive gate assigned to step 6.

Desktop emitted a Vite dependency-optimization reload warning during the passing
browser run. Its skipped SQLite cases and native application packaging/E2E were
not independently certified by this validation.

## Mutation evidence

The copied workspace/study suite passed before mutation and after restoring the
first ten faults. The additional disappearing-source mutation and its restored
targeted regression also ran successfully. Each fault was applied separately;
the shared checkout was never mutated for these checks.

| Temporary fault                                    | Observed regression failure                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Create a fresh semaphore on every lookup           | The second metadata mutation read stability 0 instead of 1                        |
| Use one semaphore for every deck                   | An independent deck timed out while another deck was paused                       |
| Remove the final rename's interrupt mask           | The next writer read stability 0 instead of the persisted 1                       |
| Release manually acquired locks only on success    | Cancelling a partially acquired rename left its source locked; the test timed out |
| Remove the EINVAL exception                        | An ordinary file produced a scan failure                                          |
| Swallow unexpected read-link errors                | EIO produced a successful partial scan instead of a fatal error                   |
| Treat every rename NotFound as a missing source    | A still-present source produced the wrong domain error                            |
| Skip the source re-stat after rename NotFound      | A disappeared source produced an operation error instead of `DeckFileNotFound`    |
| Recover every asset-write error as deduplication   | A bad argument produced a successful import                                       |
| Construct a separate manager inside the deck store | Grading overwrote the concurrent append; one item remained instead of two         |
| Replace shuffling with unchanged order             | Both shuffle regressions saw only one ordering across the chosen seeds            |

## Remaining integration gates

The entire library now builds, typechecks, and passes its tests on v4. Step 6
still owns independent archive installation, the Node 22/24 consumer matrix,
package/release tooling and CI updates, and public migration documentation.
No publication or native app-packaging success is claimed here.

The principal checks can be repeated from the repository root:

```sh
bun run --filter '@simbyotic/re' typecheck
bun run --filter '@simbyotic/re' test
bun run check:app-resolution
bun run test:app-isolation
bun run test:release
```
