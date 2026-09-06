# Library changesets

Run `bun run changeset` when a change affects the public behavior of `@simbyotic/re`. Choose a semantic-version bump and explain the caller-visible change. Commit the generated Markdown file with the implementation.

There is one published package, version, and changelog. The desktop and Raycast apps are private packages; release preparation updates their library dependency without changing their own versions.

See [the release guide](../docs/library-releases.md) for preparation, verification, and the GitHub Actions publishing workflow.
