---
"@simbyotic/re": minor
---

Migrate all five library entry points to Effect `4.0.0-rc.112`. Consumers must share that exact Effect peer and replace `@effect/platform` imports with Effect core modules; Node workspace consumers supply a matching v4 adapter. Schema codecs and validation causes, service keys, and the `Result` returned by `reconcileCards` now expose v4 types. See [the migration guide](docs/migrating-effect-v4.md) for consumer changes. Markdown data, stable card identities, and FSRS scheduling behavior are preserved. Desktop, Raycast, and Overlay continue to use their frozen Effect v3 archive.
