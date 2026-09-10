# Releasing @simbyotic/re

`@simbyotic/re` is the single public npm package. Its `core`, `item-types`, `scheduler`, `workspace`, and `study` subpath exports share one version and changelog. Overlay consumes the workspace library through `workspace:*`, with Effect and its Node adapter pinned to the library's exact v4 peer.

`bun run check:app-resolution` builds the library, verifies that Overlay resolves all five workspace exports, and checks one shared Effect installation across the app, library, and Node adapters under Node and Bun. Installing dependencies does not build the workspace library; Overlay's dev, build, typecheck, and test commands build it explicitly. Use `bun run build:library` for standalone library work.

## Current Effect v4 local prerelease

The `0.3.0-rc.0` line targets exactly `effect@4.0.0-rc.112`. Its five entry points
share that peer; workspace/study consumers supply a matching Node adapter when
needed. The old `@effect/platform` peer is removed. See the
[consumer migration guide](../packages/re/docs/migrating-effect-v4.md).

The migration delivers a local archive, with no npm upload or release tag.
Changesets prerelease mode prepares the version, changelog, and lockfile. While
that mode is active, `release:version` prepares the next rc from pending changesets.
Validate the local deliverable with:

```sh
bun install --frozen-lockfile
bun run --filter '@simbyotic/re' test
bun run --filter '@simbyotic/re' typecheck
bun run test:packages
bun run test:release
bun run release:check
```

`release:check` produces `dist/library-release/*.tgz` and `release.json`, recording
the source commit, dirty-checkout status, and SHA-512 integrity after validating
the exact archive. `pack:library` also produces an inspected archive in
`dist/packages/`. Install the archive path alongside the exact Effect peer.

The publisher still supports stable versions only. Both `release:dry-run` and
`release:publish` intentionally refuse rc versions before invoking npm. The
release workflow verifies and retains prerelease artifacts while skipping its
stable publishing route. Supporting public prereleases, including a `next` tag
and promotion rules, remains separate work.

## Record and prepare a release

Run `bun run changeset` for changes to public behavior. Select `@simbyotic/re`, choose the version bump, and describe the effect on callers. Commit the generated release note with the implementation. Use patch for compatible fixes and minor for compatible additions. Before 1.0, use a minor bump for breaking changes and include migration instructions; after 1.0, breaking changes require a major bump.

Run `bun run release:version` to consume pending changesets, update the package version and changelog, and refresh `bun.lock`. It preserves Overlay's `workspace:*` dependency and does not version or publish the app. A library version change therefore reaches Overlay's next build without editing an archive pin.

For a stable version, review and commit the result on `master`, then verify:

```bash
bun install --frozen-lockfile
bun run --filter '@simbyotic/re' test
bun run --filter '@simbyotic/re' typecheck
bun run release:check
bun run test:release
bun run release:dry-run
```

`release:check` makes a clean build and packs one archive. It installs that exact
archive into external npm consumers, checks strict NodeNext and Bundler TypeScript
resolution, and executes native ESM and CommonJS consumers. One consumer has no
Node adapter; the other supplies one and exercises workspace and study. Both
require one shared Effect installation and reject the removed `@effect/platform`
and `@effect/schema` packages. CI retains the Node 22/24 matrix. Declaration maps
must resolve to sources inside the archive, and all five exports are required.

The archive and `release.json` are written to `dist/library-release/` with SHA-512 integrity and the source commit. Publishing rejects changed archives, uncommitted source, a different checkout commit, and inconsistent package identities or versions.

## Publish

After the version commit is on `master`, create and push an annotated tag matching the package version. For version 0.2.1:

```bash
git tag -a re-v0.2.1 -m 'Release @simbyotic/re 0.2.1'
git push origin master re-v0.2.1
```

`.github/workflows/library-release.yml` runs the tests, typechecks, external-consumer checks, release-tool tests, and a publish dry run. Its publish job downloads the verified archive and publishes it without rebuilding or repacking. A manual workflow dispatch runs verification only.

If a publish job fails after uploading, rerun that failed job. It accepts an existing version only if npm's integrity matches the verified archive. A conflicting version fails. Do not move release tags or reuse a version for changed content.

## Trusted publishing setup

The npm Trusted Publisher for `@simbyotic/re` uses:

| Field                | Value                 |
| -------------------- | --------------------- |
| Provider             | GitHub Actions        |
| Organization or user | `joaoeira`            |
| Repository           | `re`                  |
| Workflow filename    | `library-release.yml` |
| Environment          | `npm`                 |
| Permission           | Publish               |

The repository Actions variable `NPM_TRUSTED_PUBLISHING=true` enables the publish job. The workflow uses GitHub OIDC and requires no long-lived npm write token. The public repository metadata lets npm attach provenance to CI publications.

A new package must exist before configuring its Trusted Publisher. For initial setup, leave the gate disabled, download the verified tag workflow artifact into `dist/library-release/` in a clean checkout of that tag, authenticate as `simbyotic` with `npm login`, and run `bun run release:publish`. Use Node 24 and npm 11.5.1 or newer. Complete npm's two-factor authorization when prompted, configure the Trusted Publisher, then enable the gate.

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/).
