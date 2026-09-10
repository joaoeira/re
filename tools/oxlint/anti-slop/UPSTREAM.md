# Anti-slop provenance

Source: https://github.com/dmmulroy/anti-slop

Revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`

Updated on 2026-09-10 from revision
`95a56e5d24fb3d849673c2d51eb0908b8bd2d33b` to the latest upstream HEAD
retrieved that day. Before updating, all existing production TypeScript files
were verified byte-for-byte against the previous revision; there were no local
implementation changes to merge. Production assets now match the new revision's
`src/`, excluding upstream test files. The upstream MIT license is included in
`LICENSE`; nested third-party license and provenance files are retained under
`vendor/`. Upstream tests remain available at the recorded revision.

Entry points:

- `tools/oxlint/anti-slop/index.ts`
- `tools/oxlint/anti-slop/effect/index.ts`

There are no local changes to the copied rule implementations. The repository's
existing Oxlint and `@oxlint/plugins` versions remain pinned together at `1.55.0`.
All 24 upstream test suites, including the readable-spacing CLI autofix test,
passed against these installed tools in a disposable checkout. The formatter
excludes this vendored directory to keep the recorded source snapshot intact.

The root `.oxlintrc.json` preserves the previously enabled generic rules, native
accumulating-spread companion rule, and Effect service-constructor rule at error
severity within `packages/`. Run `bun run lint:packages` from the repository
root; package source, tests, benchmarks, and configuration are included, while
gitignored build output is excluded. Applications remain outside these rules'
scope. The documented source-line exception for
`EvaluableCardSpec.evaluate(response: unknown)` remains the schema-validation
boundary before the typed grader.

The new `anti-slop/require-readable-spacing` rule is enabled at error severity
within the existing `packages/` scope. Its 776 initial findings were resolved
with blank-line-only autofixes across 65 files. Lint and formatter checks pass.

Four new Effect rules are available but are not enabled by this update:

- `anti-slop-effect/no-manual-effect-error-tag`
- `anti-slop-effect/no-manual-tag-comparison`
- `anti-slop-effect/no-manual-tagged-construction`
- `anti-slop-effect/prefer-effect-match`

Enabling these is a separate policy change. A read-only trial on 2026-09-10
reported 74 manual tagged-construction findings and 16 manual tag-comparison
findings. Repository lint passes with zero warnings and zero errors with
the spacing rule enabled and the four new Effect rules disabled.
