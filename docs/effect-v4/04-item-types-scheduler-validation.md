# Step 4 — Item types and scheduler migration validation

Implemented against Effect `4.0.0-rc.112`, Vitest `4.1.11`, TypeScript `5.9.3`,
and the unchanged `ts-fsrs` `5.2.3` on 2026-09-09, starting from `7082043`.
Changes are confined to three production files, four existing test files, and
this report. App sources, dependency manifests, the lockfile, and frozen
archives were not changed.

## Implemented contract

`ClozeDeletion.hint` uses `Schema.OptionFromOptional`. Missing hints and explicit
`undefined` decode to `None`, whose encoding omits the property. Strings,
including empty strings, remain `Some`; null and numeric hints are rejected.
Markdown parsing still treats an empty hint as `None`, preserving its separate
existing behavior.

The built-in batch resolver caches `Result` values by item object identity
within each call. It preserves queue order, entry fields, one error per invalid
item, and missing-card errors. Matching still checks card count before the
cloze preference. The removed `Effect.dieMessage` API is replaced with
`Effect.die(new Error(...))` in the unexpected-type invariant branch; defects
remain outside the collected domain-error results.

`Scheduler` uses `Context.Service` with its existing explicit interface and
service identifier. Configuration uses v4 codecs, checks, and effectful
decoding. A bounded, aborting step-format check protects the engine's numeric
converter; converted durations must still fit a safe integer number of minutes.
Retention remains finite and within `(0, 1]`, maximum intervals remain positive
safe integers, and unknown properties remain errors. Optional fields continue
to accept explicit `undefined`, and empty step arrays remain valid.

Configuration and engine failures still become `SchedulerConfigError`, including
the original cause. The scheduler keeps its existing array copies, execution-time
configuration capture, independent engines, grade mapping, metadata conversion,
and cap on the persisted due date after the engine schedules the review.
`SchedulerLive` retains its infallible layer contract.

## Checks

| Check                                                                                                    | Result                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Core, item-type, and scheduler runtime suites using the package Vitest configuration                     | 257 tests in 17 files passed                            |
| Scoped source, test, and core benchmark typecheck with inherited repository diagnostics                  | Passed                                                  |
| Scoped JavaScript, declaration, and declaration-map build                                                | Passed                                                  |
| Temporary emitted-package consumer with strict NodeNext and Bundler resolution and `skipLibCheck: false` | Passed                                                  |
| Native Node 24 execution of the emitted consumer                                                         | Passed                                                  |
| Fixed-input scheduling comparison with the frozen Effect v3 package                                      | 1,008 results matched exactly                           |
| Configuration acceptance comparison with the frozen package                                              | 176 cases matched                                       |
| Cloze hint decoding/encoding comparison with the frozen package                                          | 6 cases matched                                         |
| Three deliberate mutations in a disposable copy                                                          | Each targeted regression failed; restored suites passed |
| Core, item-type, and scheduler source/test lint                                                          | No warnings or errors                                   |
| Changed-file formatting and diff whitespace                                                              | Passed                                                  |

The runtime count includes two new tests: the public cloze hint codec regression
and the scheduler defaults/empty-steps regression. The existing invalid-options
test also now covers retention `NaN` and `Infinity`, plus an unsafe maximum
interval. Other tests retain their existing behavior assertions while adopting
v4 `Result` and the automatically scoped `it.effect` adapter.

Scoped configurations extended `packages/re/tsconfig.json` and
`packages/re/tsconfig.build.json`, restricting includes to the `core`,
`item-types`, and `scheduler` source/test directories. Build output and build-info
files were directed outside the checkout. No diagnostics were disabled.

The temporary consumer imported the emitted `@simbyotic/re/core`,
`@simbyotic/re/item-types`, and `@simbyotic/re/scheduler` entry points. Its explicit
type assignments checked the cloze codec's encoded representation and lack of
service requirements, the scheduler factory and scheduling error channels, and
both layer contracts. Its runtime checks covered hint encoding, built-in
matching, annotated entry fields, default scheduling, typed configuration
failure, and service provision. Only Effect, nanoid, and ts-fsrs were linked as
runtime dependencies; no platform adapter was supplied. The consumer compiler
used `ES2022`, `DOM`, and `ESNext.Disposable` libraries with no implicit Node types.

The differential schedule matrix covered seven configurations, all four card
states, three stability values, three fixed review times, and all four grades.
Fuzz was disabled for exact comparisons; the existing fuzz test still passed.
Both versions resolved the same installed FSRS engine. Full schedule results,
including metadata and logs, were compared after JSON normalization. Separate
configuration checks compared acceptance or typed rejection, rather than
version-specific schema error text.

## Mutation evidence

The copied 257-test suite passed before mutation. Each production file was
restored immediately after its targeted run; the restored cloze and scheduler
configuration suites passed all 55 tests. The shared checkout was never mutated
for these checks.

| Temporary fault                                                      | Regression                     | Observed failure                                                                                           |
| -------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Replace `OptionFromOptional` with `OptionFromOptionalKey`            | Optional hint codec round trip | An explicit `undefined` hint failed with `SchemaError: Expected string`.                                   |
| Remove the final due cap after `engine.next`                         | Final interval cap             | The engine scheduled 9 days instead of the configured 7 days: 777,600,000 versus 604,800,000 milliseconds. |
| Replace scheduler `Schema.optional` fields with `Schema.optionalKey` | Omitted/undefined defaults     | Explicit `undefined` retention failed with `SchedulerConfigError` before scheduling.                       |

## Remaining integration gates

This is scoped validation of the first three library entry points. Workspace,
study, and their consumers remain assigned to step 5. Full-library build,
typecheck, tests, and independently installed archive validation remain gates
for steps 5–6. No full-package or app-packaging success is claimed here.

The runtime checks can be repeated from `packages/re` without triggering the
full package pretest build:

```sh
bun x --no-install vitest run test/core test/item-types test/scheduler
```
