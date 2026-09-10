# Migrating to the Effect v4 library

The `0.3.0-rc.0` library targets `effect@4.0.0-rc.112` exactly. All five entry
points expose v4 Effect, Schema, and service types. Mixing v3 and v4 values in
one consumer graph is unsupported. Overlay in this repository consumes the v4
workspace package and shares its exact Effect version and matching Node adapter.

This migration preserves Markdown metadata, numeric spelling, card identities,
and FSRS scheduling behavior. Existing decks need no data migration. Seeded
queue shuffles are reproducible within the pinned v4 runtime but do not retain
the v3 generator's exact sequence.

## Dependencies and imports

Install the validated local archive and its exact peer:

```sh
npm install ./simbyotic-re-0.3.0-rc.0.tgz effect@4.0.0-rc.112
```

For workspace/study operations on Node, add
`@effect/platform-node@4.0.0-rc.112` and pin its transitive shared adapter using the
[workspace guide's override](workspace.md). Core, item types, and scheduling need no Node
adapter. Replace `@effect/platform/FileSystem` and `@effect/platform/Path` with
`effect/FileSystem` and `effect/Path`; remove the old `@effect/platform` package.
Keep one shared Effect installation across the library and adapter.

The local archive is the migration deliverable. Public prerelease publication
is not implemented; a registry install of `@simbyotic/re@0.3.0-rc.0` is not part
of the validated delivery route.

## Custom item types

The `ItemType` contract still has explicit content, response, and grading-error
parameters. Parsing callbacks must return Effects. A v3 callback could return a
yieldable domain error directly:

```ts
// v3 callback fragment
parse: (raw) =>
  raw.startsWith("vocabulary:")
    ? Effect.succeed({ answer: raw.slice("vocabulary:".length) })
    : new ContentParseError({ type: "vocabulary", raw, message: "Expected prefix" });
```

In v4, wrap that failure with `Effect.fail`:

```ts
import { Effect, Schema } from "effect";
import { ContentParseError, type ItemType } from "@simbyotic/re/core";

const VocabularyType: ItemType<{ readonly answer: string }, string> = {
  name: "vocabulary",
  parse: (raw) =>
    raw.startsWith("vocabulary:")
      ? Effect.succeed({ answer: raw.slice("vocabulary:".length) })
      : Effect.fail(new ContentParseError({ type: "vocabulary", raw, message: "Expected prefix" })),
  cards: ({ answer }) => [
    {
      key: "main",
      prompt: "Type the answer",
      reveal: answer,
      cardType: "vocabulary",
      responseSchema: Schema.String,
      grade: (response) => Effect.succeed(response === answer ? 2 : 0),
    },
  ],
};
```

`yield* new ContentParseError(...)` remains valid inside an Effect generator.
Grading still has no outstanding service requirements: supply dependencies
inside the grader. Evaluation preserves custom typed errors alongside
`ResponseValidationError`.

## Schema codecs and errors

Use `Schema.decodeUnknownEffect` and `Schema.encodeEffect` for Effect-returning
operations. Synchronous helpers remain `Schema.decodeUnknownSync` and
`Schema.encodeSync`. Model schemas still validate Dates as in-memory Dates;
Markdown encoding remains the job of `serializeMetadata` and `serializeFile`.

`CardSpec.responseSchema` is
`Schema.Codec<Response, Response, never, never>`, preserving both representations
and the absence of decoding/encoding service requirements. `Schema.Schema<T>`
alone does not express the complete codec contract. The `cause` on
`ResponseValidationError` is now `Schema.SchemaError`, replacing
`ParseResult.ParseError`.

Cloze hints remain `Option<string>`. Missing or explicit-`undefined` hints
decode to `None` and encode with the property omitted. The public schema
preserves an empty string as `Some("")`; Markdown parsing still treats an empty
hint as absent.

## Reconciliation results

Previously, `reconcileCards` returned an `Either` that could be yielded directly:

```ts
// v3, inside an Effect generator
const matched = yield * reconcileCards(previous, nextKeys);
```

It now returns `Result`, so convert explicitly at the Effect boundary:

```ts
// v4, inside the same locked edit callback
const matched = yield * Effect.fromResult(reconcileCards(previous, nextKeys));
```

For pure callers, use `Result.isFailure(result)` and `result.failure`; success
uses `result.success`. Matching, duplicate-key failures, and metadata preservation
are unchanged. Keep reconciliation inside `DeckManager.modifyItem` so it uses
the latest locked metadata.

## Services, platform errors, and tests

Library service keys use `Context.Service<Interface>(identifier)` with their
existing identifiers and explicit interfaces. Preserve each public layer's
requirements. Reuse one manager layer object when composing stores and queues;
independently constructed managers do not share locks. The [study guide](study.md)
shows the complete graph.

Filesystem failures now wrap a typed reason in `PlatformError`. Use
`Effect.catchReason("PlatformError", "NotFound", ...)` or `Effect.catchReasons`
where policies differ, and map remaining failures uniformly when appropriate.
Store methods already expose their domain error tags; consumers do not need to
reclassify platform errors after `runPromise`.

For application bridges, `ManagedRuntime.ManagedRuntime.Services<typeof runtime>`
replaces `ManagedRuntime.ManagedRuntime.Context<typeof runtime>`, and
`Effect.catch` replaces `Effect.catchAll`. Keep runtime disposal at the app's
shutdown boundary, after outstanding writes have settled.

Library tests use `@effect/vitest@4.0.0-rc.112` with Vitest `4.1.11`.
`it.effect` replaces `it.scoped`, and `it.live` replaces `it.scopedLive`; both
scope resources automatically. TestClock comes from `effect/testing/TestClock`.
After `Fiber.interrupt`, inspect the exit with `Fiber.await` and
`Exit.hasInterrupts`. Overlay's application tests use Bun's test runner with the
same v4 workspace package; they do not require the Vitest adapter.

Independent package checks compile strict NodeNext and Bundler consumers and
execute native ESM/CommonJS on Node 22 and 24. They validate all five exports,
one Effect installation, and the absence of removed v3 platform dependencies.
