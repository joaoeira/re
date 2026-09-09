# Effect v4 library scope

This package targets exactly `effect@4.0.0-rc.112`,
`@effect/platform-node-shared@4.0.0-rc.112`, `@effect/vitest@4.0.0-rc.112`,
and Vitest `4.1.11`. Root Effect v3 examples continue to apply to the deferred
app sources; use the following v4 APIs in `packages/re`. Root test-quality and
explicit-interface requirements still apply.

Before implementing Effect features, run `effect-solutions list` and read the
relevant guides. Those guides may describe v3 APIs: verify version-sensitive
advice against the installed rc.112 source or the pinned upstream references.

## Contracts and errors

Define each service interface explicitly and export
`Context.Service<Interface>(existingIdentifier)` separately from its layer.
Keep public method error/environment channels visible. Capture dependencies
when constructing a store so its methods remain `R = never`; preserve the
documented layer requirements and reuse the same manager layer object across
cooperating stores and queues.

Use `effect/FileSystem`, `effect/Path`, and `effect/PlatformError` in library
source. Node adapters belong in consumer composition, tests, or benchmarks.
Do not introduce `@effect/platform`, `@effect/schema`, Node adapters, or unstable
modules into the public library implementation.

Use `Effect.catchTags` for distinct domain policies and
`Effect.catchReason`/`Effect.catchReasons` for nested platform reasons. Their
handlers receive the reason and wrapper; retain the wrapper when formatting a
domain failure. Use the fallback callback when special handlers fail with domain
errors, so a subsequent generic mapper cannot rewrap those errors. Uniform
`mapError` wrapping remains appropriate. Do not classify unknown Effect errors
using `_tag` or `instanceof` cascades after crossing into Promise code.

Callbacks that return Effects must use `Effect.fail(domainError)`; yielding a
domain error inside a generator remains valid. `Result` requires
`Effect.fromResult` at the Effect boundary. Use `Effect.result` rather than
`Effect.either`; defects and interruptions must remain outside collected results.

## Schema and array APIs

Use `Schema.Codec<Type, Encoded, DecodeServices, EncodeServices>` when all public
codec dimensions matter. `CardSpec.responseSchema` must retain
`Codec<Response, Response, never, never>`. Response validation causes are
`Schema.SchemaError`. Use `decodeUnknownEffect`, `encodeEffect`, `toType`,
`Literals([...])`, `Union([...])`, and `.check(...)` as appropriate.

`Schema.OptionFromOptional` preserves missing and explicit-undefined cloze hints;
`OptionFromOptionalKey` does not. Ordinary optional configuration fields use
`Schema.optional`, preserving explicit undefined. Guard throwing converters
with an aborting filter or a single short-circuiting predicate.

`Array.partition` and `Array.filterMap` consume Result callbacks in rc.112;
`Random.shuffle` returns an array. Use `Order.Number`/`Order.String`.

## Persistence and verification

Keep the lock registry inside `DeckManagerLive`. Lock creation must be synchronous
and atomic, with normalized/deduplicated/sorted path acquisition. Do not evict a
lock while it can have waiters. Hold permits through read/modify/write and scoped
temporary-file cleanup; the final rename stays uninterruptible after it starts.
Waiting and validation remain interruptible.

Use `it.effect` or `it.live` from the pinned adapter; both scope automatically.
TestClock is in `effect/testing/TestClock`. `Fiber.interrupt` returns void;
await the exit separately. Prefer Deferred barriers to sleeps for concurrency.
Preserve defect identity with `Exit.findDefect`, and test shuffle contracts rather
than a fixed v3 permutation. Prove subtle regressions with temporary mutations.

Run package typechecking regularly and meaningful targeted tests while editing.
Finish with the full library suite and external archive consumers; do not use
stale `dist` output as evidence. App pins remain on the frozen v3 artifact.

Pinned upstream references: [Effect](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/Effect.ts),
[Schema](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/Schema.ts),
[Context](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/Context.ts),
[PlatformError](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/PlatformError.ts),
[Semaphore](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/Semaphore.ts),
and [Vitest adapter](https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/vitest/src/index.ts).
