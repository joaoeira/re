# Anti-slop provenance

Source: https://github.com/dmmulroy/anti-slop

Revision: `95a56e5d24fb3d849673c2d51eb0908b8bd2d33b`

Installed on 2026-09-09 using that revision's
`skills/install-anti-slop/scripts/install.mjs`. Its bundled production TypeScript
assets were verified byte-for-byte against `src/` with
`node scripts/sync-skill-assets.mjs --check` before installation. The upstream
MIT license is included in `LICENSE`. Upstream test files are not part of the
installer's payload; they remain available at the recorded revision.

Entry points:

- `tools/oxlint/anti-slop/index.ts`
- `tools/oxlint/anti-slop/effect/index.ts`

There are no local changes to the copied rule implementations. The repository's
existing Oxlint and `@oxlint/plugins` versions are pinned together at `1.55.0`.
The root `.oxlintrc.json` enables every generic rule, the native accumulating
spread companion rule, and the Effect rule at error severity within `packages/`.
Existing lint rules are preserved. Run `bun run lint:packages` from the repository
root; package source, tests, benchmarks, and configuration are included, while
gitignored build output is excluded. Applications are outside the new rules'
scope. Package findings have been reviewed and cleaned up. One documented
source-line exception preserves `EvaluableCardSpec.evaluate(response: unknown)`:
that method is the schema-validation boundary before the typed grader. Rule
implementations and configured severities remain unchanged by the cleanup.

The 18 upstream rule test suites passed against the installed `1.55.0` tools in
a disposable checkout. The formatter excludes this vendored directory to keep
the recorded source snapshot intact.
