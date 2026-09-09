# Effect v4 package and release validation

Validated locally on 2026-09-09. Step 6 completes the installable package boundary
for `@simbyotic/re@0.3.0-rc.0`. The deliverable is a local archive; public
prerelease publishing remains unimplemented.

## Versions and release preparation

The library and external consumers use exactly Effect `4.0.0-rc.112`, with
matching Node adapters and `@effect/vitest`. Library Vitest is `4.1.11`,
TypeScript is `5.9.3`, the Effect language service is `0.87.2`, and Bun is
`1.2.21`. Native consumer checks passed on Node `22.22.0` and `24.7.0`.

Changesets prepared `0.3.0-rc.0` through `changeset pre enter rc` and
`release:version`, including the pending built-in review and study changesets.
The app manifests, frozen archive, and `bun.lock` remain byte-for-byte unchanged
from the step 5 commit. All three apps still resolve library
`0.2.1-effect3.0` and Effect `3.19.18`.

The existing [toolchain validation](00-toolchain-setup-validation.md) records the
positive and deliberately invalid v3/v4 language-service probes. The final
library and app typechecks pass without disabling diagnostics. The previously
identified grading error was corrected before the frozen v3 checkpoint; the
final library suite retains its public persistence-error regression.

## Package gates

| Check                                                                        | Result                                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Normal `bun install --frozen-lockfile`, including lifecycle scripts          | Passed                                                                              |
| Full library typecheck and build                                             | Passed                                                                              |
| Full library test suite                                                      | 452 tests in 34 files passed                                                        |
| Archive inspection                                                           | 181 files; all five exports, declaration maps, and referenced sources present       |
| Node 22 isolated npm consumers                                               | Both scenarios passed                                                               |
| Node 24 isolated npm consumers                                               | Both scenarios passed                                                               |
| Package guard tests                                                          | 4 passed                                                                            |
| Release-tool tests                                                           | 4 passed, including stable integrity/dirty-source guards and rc publication refusal |
| Frozen app isolation tests                                                   | 4 passed                                                                            |
| App resolution under Node and Bun                                            | All three apps retained the frozen v3 graph                                         |
| Changed tooling lint, formatting, diff whitespace, and workflow YAML parsing | Passed                                                                              |

Each external consumer installs the actual archive outside the repository using
npm with lifecycle scripts disabled and no injected Node resolution or loaders.
Both strict NodeNext and Bundler compilation pass, followed by native ESM and
CommonJS execution. Every installation has one physical Effect installation,
valid npm peers, and no legacy `@effect/schema` or `@effect/platform` package.
The scheduler scenario has no Node platform adapter. The filesystem scenario
uses the matching adapter and covers all five entry points, including study
authoring, loading, grading, persisted schedule bytes, and grade undo through
captured services whose methods require no additional Effect environment.

In disposable script copies, removing each new guard for a missing study export,
an old platform peer, or an old platform import caused its corresponding test
to fail with a missing expected rejection. The unmodified four-test baseline
passed again. The changed public documentation examples are covered by the
external consumer contracts, including custom item types, schema composition,
Result conversion, scheduling, and the shared study service graph.

## Deferred app gates

| App                                                                     | Result                                                                             |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Desktop standalone npm install and subsequent `npm ci`                  | Passed; one shared Effect/platform/React installation and the exact frozen library |
| Desktop native SQLite probe, lint, and typecheck                        | Passed                                                                             |
| Desktop full unit/browser suite                                         | 703 tests in 68 files passed; zero skips                                           |
| Desktop installer-tool tests                                            | 2 passed                                                                           |
| Desktop Forge packaging                                                 | macOS ARM64 DMG and ZIP produced                                                   |
| Desktop packaged E2E                                                    | 1 passed; renderer, IPC, and SQLite with fresh user data                           |
| Raycast standalone installation, typecheck, tests, and production build | Passed; 40 tests in 6 files                                                        |
| Overlay frozen resolution, typecheck, native build, and tests           | Passed; 17 tests plus the explicit 4-test rendering run                            |

The first Desktop run exposed a browser test racing a 30 ms simulated save.
The test now explicitly completes that save after observing the pending draft.
Its 13-test file passed, followed by the full 703-test suite. Validation resumed
in the already installed standalone checkout with that test file updated;
lint, typecheck, the complete suite, packaging, and E2E all passed. Application
production code and dependency pins were not changed. This closes the earlier
step 5 gap of ten skipped SQLite tests and deferred native packaging/E2E.

## Delivery and CI

The validated archive is `dist/library-release/simbyotic-re-0.3.0-rc.0.tgz`,
also copied to `dist/packages/`. The adjacent `release.json` is the canonical
record of its SHA-512 integrity, source commit, and clean-checkout status.
Final delivery uses a clean checkout of the committed source and validates the
same archive on both supported Node versions.

CI retains the Node 22/24 consumer matrix with the exact Effect pin and adds
the archive guard tests and app-resolution check. Overlay has a native macOS
job. The release workflow verifies and retains rc archives while skipping the
stable-only publishing route; stable releases preserve the exact archive
handoff. Workflow YAML was parsed locally; hosted CI was not dispatched.
No npm publication, release tag, or push was performed.
