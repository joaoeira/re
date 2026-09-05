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

## Configuring scheduling

Use `makeScheduler` to create a scheduler directly, or `makeSchedulerLayer` to provide it to
an existing Effect program. Both accept the exported `FSRSOptions` type, using TS-FSRS's
parameter names. Omitted settings use the installed engine's defaults.

```ts
import { Effect } from "effect";
import { createMetadata } from "@re/core";
import { makeScheduler, makeSchedulerLayer, Scheduler, type FSRSOptions } from "@re/scheduler";

const options = {
  request_retention: 0.95,
  maximum_interval: 365,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
  enable_fuzz: true,
} satisfies FSRSOptions;

const direct = Effect.gen(function* () {
  const scheduler = yield* makeScheduler(options);
  return yield* scheduler.scheduleReview(createMetadata(), 2, new Date());
});

const review = Effect.gen(function* () {
  const scheduler = yield* Scheduler;
  return yield* scheduler.scheduleReview(createMetadata(), 2, new Date());
});
const scheduling = makeSchedulerLayer(options);
const provided = review.pipe(Effect.provide(scheduling));

const result = Effect.runSync(provided);
```

| Option              | Meaning and accepted values                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request_retention` | Target recall probability: greater than 0 and at most 1. Higher values generally shorten intervals. Default: `0.9`.                                                                                     |
| `maximum_interval`  | Positive safe integer number of days. Caps the final due date, including configured learning steps. Default: `36500`.                                                                                   |
| `learning_steps`    | Positive whole-number durations such as `"1m"`, `"2h"`, or `"1d"`. Default: `["1m", "10m"]`.                                                                                                            |
| `relearning_steps`  | The same duration format, used after forgetting a learned card. Default: `["10m"]`.                                                                                                                     |
| `enable_fuzz`       | Vary longer intervals slightly. Default: `false`.                                                                                                                                                       |
| `enable_short_term` | Enable short-term scheduling. When `false`, both step lists are ignored. Default: `true`.                                                                                                               |
| `w`                 | Finite model weights in a supported FSRS layout (currently 17, 19, or 21 entries). TS-FSRS migrates older layouts and clips coefficients to its supported ranges. Omitted: the engine's built-in model. |

An empty step list (`[]`) lets FSRS determine those intervals. Step durations must be positive
and fit in a safe integer number of minutes. Zero is rejected because the engine treats it as
no step, and fractional amounts are rejected because the engine truncates them.
Settings are validated when the construction Effect runs or the layer is built.
Invalid values and unknown option names fail with `SchedulerConfigError`, which includes
`message` and `cause` and can be handled with `Effect.catchTag("SchedulerConfigError", ...)`.
`makeScheduler` returns `Effect<Scheduler, SchedulerConfigError>`; `makeSchedulerLayer` returns
`Layer<Scheduler, SchedulerConfigError>`. `SchedulerLive` retains its error-free layer type.

Each constructed scheduler captures its settings, including copies of the arrays. Editing
the supplied options afterwards does not change that scheduler. Create another scheduler
when settings change; apps own persistence and choose which scheduler serves each deck or
profile. Settings affect subsequent reviews and never move a card's saved due date by themselves.
`SchedulerLog.scheduledDays` records the previous interval from the saved timestamps, independently
of the selected retention target or the card's stability estimate.

## Due dates and storage

`computeDueDate`, `isCardDue`, and `resolveDueDateIfDue` use the stored due date. Cards without
a due date and new cards are not counted as due. Scheduling an already-reviewed card requires
both `lastReview` and `due`; missing timestamps fail with `ScheduleError`.
Scheduling failures use the tagged `ScheduleError` error. Conversion helpers and the
`FSRSGrade`, `ScheduleResult`, and `SchedulerLog` types are also exported.

This package depends on `@re/core` and `ts-fsrs`, with `effect` as a peer. It requires no
`@re/workspace`, `@effect/platform`, or filesystem layer. Filesystem deck persistence,
snapshots, and review queue construction are provided by `@re/workspace`.

Build locally with `bun run build`. From the repository root, `bun run pack:libraries`
creates installable archives and `bun run check:packages` verifies isolated scheduler
and workspace consumers.
