# @re/scheduler

FSRS scheduling for re items, independent of workspace storage. This package takes card
metadata, a grade, and a review timestamp and returns updated metadata and a review log.
It exports ESM JavaScript and TypeScript declarations and uses Effect services.

```ts
import { Effect } from "effect";
import { createMetadata } from "@re/core";
import { Scheduler, SchedulerLive } from "@re/scheduler";

const card = createMetadata();
const reviewedAt = new Date("2026-01-01T12:00:00.000Z");
const result = Effect.runSync(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler;
    return yield* scheduler.scheduleReview(card, 2, reviewedAt);
  }).pipe(Effect.provide(SchedulerLive)),
);

// Persist result.updatedCard using your application's storage.
```

Grades are `0` (Again), `1` (Hard), `2` (Good), and `3` (Easy). `SchedulerLive` uses the
default `ts-fsrs` configuration. The `Scheduler` interface is exported explicitly for
consumers that provide their own implementation.

`computeDueDate`, `isCardDue`, and `resolveDueDateIfDue` prefer the stored due date, with
legacy reconstruction when it is absent. New cards are not counted as due.
Scheduling failures use the tagged `ScheduleError` error. Conversion helpers and the
`FSRSGrade`, `ScheduleResult`, and `SchedulerLog` types are also exported.

This package depends on `@re/core` and `ts-fsrs`, with `effect` as a peer. It requires no
`@re/workspace`, `@effect/platform`, or filesystem layer. Filesystem deck persistence,
snapshots, and review queue construction are provided by `@re/workspace`.

Build locally with `bun run build`. From the repository root, `bun run pack:libraries`
creates installable archives and `bun run check:packages` verifies isolated scheduler
and workspace consumers.
