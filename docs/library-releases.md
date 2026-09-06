# Releasing the shared libraries

The public npm packages are `@simbyotic/re-core`, `@simbyotic/re-item-types`,
`@simbyotic/re-scheduler`, and `@simbyotic/re-workspace`. They share one version through
Changesets' fixed group. The authenticated npm account is `simbyotic`; npm's `@re` scope
is already in use, and npm reported that the `joaoeira` organization name is unavailable.

## Record and prepare a release

For a public behavior change, run `bun run changeset` and commit the generated release note
with the implementation. Describe the effect on callers, including migration instructions
for breaking changes. Use patch for compatible fixes, minor for compatible additions,
and major for breaking changes once the packages reach 1.0. Before 1.0, use a minor bump
for breaking changes and state that explicitly in the release note.

Run `bun run release:version` to consume pending changesets, version all four libraries,
generate package changelogs, and refresh `bun.lock`. While the apps remain in this repository,
the command also updates their exact library dependency versions so Bun continues linking
the workspace packages. It does not change the apps' versions or publish them.

Review and commit those changes on `master`, then verify the release:

```bash
bun install --frozen-lockfile
bun run --filter '@simbyotic/re-*' test
bun run --filter '@simbyotic/re-*' typecheck
bun run release:check
bun run test:release
bun run release:dry-run
```

`release:check` makes a clean library build and packs the four archives once. It installs
those exact files into external npm consumers, checks both TypeScript resolution modes,
and executes ESM and CommonJS consumers. It writes the archives and `release.json` to
`dist/library-release/`, including their SHA-512 integrity values and source commit.
A dry run uploads nothing. Real publishing rejects changed archives, uncommitted source,
a different checkout commit, and inconsistent versions or package identities.

## First publication and npm setup

Use Node 24 and npm 11.5.1 or newer. Authenticate as `simbyotic` with `npm login`, then
publish the already verified archives with `bun run release:publish`. npm may require
interactive two-factor authorization. Do not paste credentials into repository files.

Trusted publishing requires each package to exist first. After the initial publication,
configure each package's npm Trusted Publisher with:

| Field                | Value                 |
| -------------------- | --------------------- |
| Provider             | GitHub Actions        |
| Organization or user | `joaoeira`            |
| Repository           | `re`                  |
| Workflow filename    | `library-release.yml` |
| Environment          | `npm`                 |
| Permission           | Publish               |

After configuring all four packages, set the GitHub repository Actions variable
`NPM_TRUSTED_PUBLISHING` to `true`. Until then, release tags run verification and retain
the artifacts, but skip automatic publication. This supports the first-publication bootstrap.

The npm account must have two-factor authentication enabled. The workflow uses GitHub's
OIDC identity; it does not need a long-lived npm write token. The package repository metadata
points to this public repository so npm can attach provenance when publishing through CI.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and
[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

## Publish subsequent releases

After the version commit is on `master`, create and push an annotated tag matching all
four package versions. For version 0.1.1, for example:

```bash
git tag -a libraries-v0.1.1 -m 'Release libraries 0.1.1'
git push origin master libraries-v0.1.1
```

The tag starts `.github/workflows/library-release.yml`. Verification runs library tests,
typechecks, external-consumer checks, release-tool tests, and a publish dry run. The publish
job downloads the verified artifacts and publishes them in dependency order: core, item-types,
scheduler, workspace. It never rebuilds or repacks them. A manually dispatched workflow runs
verification only and does not publish.

npm cannot atomically publish four packages. If publication stops midway, rerun the failed
publish job so it reuses the same verified artifact. The publisher checks every existing
version before writing anything and skips it only when its registry integrity matches the
archive. A conflicting existing version fails the release. Do not move an existing release
tag or overwrite a package version; prepare a new version when content must change.

The apps adopt releases through explicit dependency updates and their own CI. Moving those
apps into separate repositories and removing their temporary vendor archives is a separate step.
