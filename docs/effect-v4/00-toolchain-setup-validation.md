# Pinned Effect v4 toolchain setup

Prepared on 2026-09-09 from `b368202` in the isolated
`task/effect-v4-toolchain` worktree. This completes the dependency and tooling
setup that precedes the core migration. The library implementation, domain
tests, app manifests, and frozen v3 archive are unchanged.

This is an intermediate migration branch, not a releasable library. Its full
library build/typecheck and domain suite still require the source and test API
conversions in steps 3–5. No diagnostics, tests, or compiler checks were disabled
to make the setup appear green.

## Version selection

| Component                                       | Selected version  |
| ----------------------------------------------- | ----------------- |
| Library `effect` dev dependency and public peer | `4.0.0-rc.112`    |
| Library `@effect/platform-node-shared`          | `4.0.0-rc.112`    |
| Library `@effect/vitest`                        | `4.0.0-rc.112`    |
| Library Vitest                                  | `4.1.11`          |
| Root Effect language service                    | `0.87.2`          |
| TypeScript, unchanged                           | `5.9.3`           |
| App Effect runtime, unchanged                   | `3.19.18`         |
| App library archive, unchanged                  | `0.2.1-effect3.0` |

The exact release metadata was checked against npm before installation. The
selected Effect test adapter requires Vitest `>=4.1.0 <5.0.0`; its
[versioned upstream manifest](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/vitest/package.json)
uses `4.1.11` for development.

Both library declarations of `@effect/platform` and its optional-peer metadata
were removed. The v3 package remains installed for the apps. The library's old
platform imports are still visible to the compiler and must be converted during
the source migration; their accidental resolution through the apps' v3 package
is not accepted as v4 compatibility.

The existing library Vitest configuration works unchanged: it selects
`test/**/*.test.ts` and inlines `@effect/vitest`. Library execution selects Vitest
4.1.11 and its matching v4 Effect adapter, while Raycast selects Vitest 3.2.7 and
`@effect/vitest` 0.27.0. The Node filesystem adapter resolves the library's v4
Effect installation. No root Effect override was introduced.

Unrelated dependency versions were preserved. In particular, Bun re-resolved
the library's existing `@types/bun: latest` declaration during the update; the
original `@types/bun`/`bun-types` 1.4.1 lock entries were retained and verified by
the clean frozen install. TypeScript and `ts-fsrs` were not upgraded.

## Diagnostic compatibility

Two disposable npm workspace fixtures compared language-service 0.64.1 with
0.87.2 using TypeScript 5.9.3 and the exact Effect versions above. Each fixture
used its own locally patched compiler. The valid controls combined an explicit
service interface, `Context.GenericTag` on v3 or `Context.Service` on v4, a
provided layer, and Schema decoding. The invalid control was
`Effect.fail(new Error(...))` with `globalErrorInEffectFailure` configured as an
error.

| Language service | Effect       | Valid service/Schema | Deliberate global Error |
| ---------------- | ------------ | -------------------- | ----------------------- |
| 0.64.1           | 3.19.18      | Passed               | Rejected with TS35      |
| 0.64.1           | 4.0.0-rc.112 | Passed               | Rejected with TS35      |
| 0.87.2           | 3.19.18      | Passed               | Rejected with TS35      |
| 0.87.2           | 4.0.0-rc.112 | Passed               | Rejected with TS35      |

Version 0.87.2 was then pinned and tested with the repository's actual diagnostic
configuration. Desktop, Raycast, and Overlay typechecks passed. A valid v4 probe
compiled through that patched compiler; adding the deliberate failure produced
exactly one diagnostic, `effect(globalErrorInEffectFailure)`. The mutation was
restored. This verifies the tested diagnostic contract, not every possible v4
language-service rule. No severity settings or duplicate-package exceptions
were added.

## Runtime and installation checks

Validation used Node 24.7.0, Bun 1.2.21, and npm 11.5.1 on macOS arm64.

| Check                                                                      | Result                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Fresh `bun install --frozen-lockfile`, lifecycle scripts enabled           | Passed; lockfile remained byte-identical                        |
| `bun run check:app-resolution`                                             | Passed under Node and Bun; library v4, all three apps frozen v3 |
| `bun run test:app-isolation`                                               | 4 passed                                                        |
| `bun run test:release`                                                     | 3 passed                                                        |
| `bun run desktop:typecheck`                                                | Passed                                                          |
| `bun run raycast:typecheck`                                                | Passed                                                          |
| `bun --cwd=apps/overlay run typecheck`                                     | Passed                                                          |
| `bun run raycast:test`                                                     | 40 passed with the retained v3 test runner                      |
| Temporary v4 runtime probes using the library's actual Vitest config       | 3 passed                                                        |
| Temporary v4 probe/config typecheck using the inherited repository options | Passed                                                          |

The v4 runtime probes exercised an explicit service and Schema decoder through
the Node filesystem adapter, independently read persisted bytes, and verified
that the test scope removed its temporary directory. They also verified that
`it.effect` uses the v4 TestClock and that `it.live` uses the live clock. The probes
passed again after the clean frozen installation. Their temporary source/config
files were removed rather than adding upstream-library smoke checks to the
permanent domain suite.

The clean-install check removed only the isolated worktree's dependency
directories, then ran the normal installer with `prepare` enabled. Step 1 has
already reduced root `prepare` to `effect-language-service patch`, so it does not
require the still-unmigrated library to build.

## Remaining migration work

The unconverted full library typecheck was run and fails as expected: old
Schema/Effect APIs, removed test methods, and v3 platform imports remain. Those
imports also produce useful duplicate-Effect diagnostics. No full library test,
package-consumer, native app packaging, or packaged-app E2E success is claimed
for this intermediate branch.

During module conversion, run package-local source tests from `packages/re`:

```sh
bun x --no-install vitest run test/core
```

This bypasses the package's `pretest` full build. Migrate `it.scoped` to `it.effect`
and `it.scopedLive` to `it.live` alongside the owning suites; the v4 adapter scopes
both forms. Use `effect/testing/TestClock` for the v4 test clock. Keep the apps'
v3 test APIs intact. The normal library build, typecheck, complete domain suite,
and external package consumers remain the final migration gate.
