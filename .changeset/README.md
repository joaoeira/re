# Library changesets

Run `bun run changeset` when a change affects a library's public behavior. Select the
relevant library, choose a semantic-version bump, and explain the caller-visible change.
Commit the generated Markdown file alongside the implementation.

The four `@simbyotic/re-*` libraries form one fixed release group. Preparing a release
bumps all four to the same version and generates their changelogs. The desktop and Raycast
apps are private npm packages and are not part of this release group.

See [the release guide](../docs/library-releases.md) for preparation, verification,
first-publication setup, and the GitHub Actions publishing workflow.
