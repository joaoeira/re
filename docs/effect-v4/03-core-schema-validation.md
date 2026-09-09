# Step 3 — Core Schema migration validation

Implemented against Effect `4.0.0-rc.112`, Vitest `4.1.11`, and TypeScript `5.9.3`
on 2026-09-09, starting from `ab6830a`. Changes are confined to core source,
core tests, and this report. App sources, dependencies, frozen archives, and
other library modules were not changed.

## Implemented contract

The four string codecs now use `Schema.decodeTo` and `SchemaGetter`, with explicit
`Schema.Codec<T, string, never, never>` contracts. Decimal grammar, raw precision,
finite string-decoding checks, state values, safe learning-step integers, timezone
requirements, and calendar normalization rejection are preserved. In-memory
schemas still validate objects and Date instances; they do not impose new
cross-field relationships or raw/value consistency checks.

`CardSpec.responseSchema` explicitly preserves `Codec<Response, Response, never,
never>`. `ResponseValidationError.cause` is now `Schema.SchemaError`; evaluation
retains its grading error union and has no outstanding service requirements.
Parser failure branches return failed Effects, and public domain error tags
are unchanged.

`reconcileCards` now returns `Result`, preserving validation order, stable-key
matching, metadata, and `Option.none()` for new keys. Its optional lookup uses
v4's `Option.fromNullishOr`. Core tests use v4 decoding/encoding, result, and
fiber APIs. In particular, `Effect.yieldNow` is a value and interruption tests
await the fiber exit after interrupting it.

## Checks

| Check                                                                                                      | Result                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Core runtime suites through the library's actual Vitest configuration                                      | 179 tests in 12 files passed                                                                         |
| Scoped core source/test/benchmark typecheck with inherited repository diagnostics                          | Passed                                                                                               |
| Scoped core JavaScript/declaration/declaration-map build                                                   | Passed                                                                                               |
| Emitted declaration inspection                                                                             | Exact codec representations/services, SchemaError cause, Result return, and grading unions preserved |
| Temporary emitted-core consumer, NodeNext and Bundler resolution, strict checks with `skipLibCheck: false` | Passed                                                                                               |
| Native Node 24 execution of the temporary consumer                                                         | Decode/encode precision, Markdown round trip, typed grading, and reconciliation passed               |
| Core source/test lint, formatting, and diff whitespace                                                     | Passed                                                                                               |

The runtime total comprises the 178 existing core cases plus one compact
safe-integer decoding/encoding regression. Compile-time assertions in the
existing item-type suite accept primitive and Trim response codecs, reject
string-encoded numeric responses and required decoding/encoding services, and
preserve the environment-free evaluation signature and typed SchemaError cause.
These assertions were compiled with TypeScript, not merely transpiled by Vitest.

Scoped typechecking and declaration generation used disposable configurations
extending `packages/re/tsconfig.json` and `packages/re/tsconfig.build.json`, with
include lists restricted to `src/core/**/*.ts` and, for the test check,
`test/core/**/*.ts`. Build output and build-info files were directed outside the
checkout. No diagnostics were disabled.

The temporary consumer imported the newly emitted core JavaScript/declarations
with the selected Effect and nanoid dependencies linked into its disposable
folder. This verifies the emitted core contract; it is not the independent npm
installation or five-entry-point archive check assigned to step 6. Its isolated
compiler configuration included `ES2022`, `DOM`, and `ESNext.Disposable`, since
Effect's declarations reference disposable-resource types. Node types were not
implicitly supplied in this minimal consumer.

## Mutation evidence

Mutations ran in a disposable copy, never against the shared checkout. The copied
core suite passed first. Each changed file was restored immediately afterward;
the restored schema suite and scoped typecheck passed.

| Temporary fault                                              | Regression                                                                      | Observed failure                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Encode numeric fields using `String(value)` instead of `raw` | `encodes back to raw string`                                                    | Received `5.2` instead of `5.20`.                                                                                                 |
| Bypass calendar component comparison                         | The three invalid-calendar cases                                                | Normalized Feb 30 and non-leap Feb 29 values succeeded instead of producing schema failures, causing the flipped effects to fail. |
| Replace the learning-step Int target with Number             | `preserves the safe-integer boundary when decoding and encoding learning steps` | The unsafe integer was accepted instead of rejected.                                                                              |
| Widen the response codec's encoded type to `any`             | The string-encoded numeric response type assertion                              | TypeScript rejected the negative assignability assertion with TS2554, proving the accidental public widening was detected.        |

## Remaining integration gates

The full library typecheck was run and still fails in the unconverted item types,
scheduler, workspace, study, scripts, and tests. Core has no scoped type errors;
in the full program it also receives the package-wide duplicate-Effect diagnostic
because remaining v3 platform imports pull Effect v3 into that compilation. That
diagnostic has not been suppressed. Full library and installed-package validation
remain gates for steps 4–6.

When migrating the remaining consumers of `reconcileCards`, insert
`Effect.fromResult` at the Effect boundary in `src/study/review-store.ts` and
`test/package-consumer/index.ts`. Their migration stays with steps 5 and 6.
No package-wide compilation or app packaging success is claimed here.

The core runtime check can be repeated from `packages/re`:

```sh
bun x --no-install vitest run test/core
```
