# re for Raycast

Create and review Q&A and cloze cards directly in re Markdown decks.

## Setup

In the standalone repository, install dependencies and run development mode:

```bash
npm ci
npm run dev
```

Use Node 22.22.2 or newer and Raycast on macOS. The standalone export includes library archives
under `vendor/` and a lockfile, so installation does not require this monorepo or published
`@re/*` packages.

The first time you open **Create Card**, Raycast asks for the **Decks Folder**. Choose the
directory that contains your re Markdown decks. The extension scans that directory recursively
and respects `.reignore`.

Submit a card with `⌘ ↵`. By default the form remains open and clears the card fields after a
successful write. Enable **Close Raycast After Creating a Card** in the extension preferences if
you want a successful submission to close Raycast instead.

Press `⌘ ⇧ V` to insert a copied image into the last-focused card field. The extension accepts
PNG, JPEG, WebP, and GIF images up to 10 MiB, stores them in the workspace's `.re/assets`
directory, and adds the corresponding Markdown to the card.

Open **Review Cards** to build one shuffled queue from all new and due cards in the configured
folder. Press `↵` to reveal a card and `↵` again to grade it **Good**. Use `⌘ 1`, `⌘ 2`, `⌘ 3`,
or `⌘ 4` to grade it **Again**, **Hard**, **Good**, or **Easy**. Each grade updates the card's
scheduling metadata in its original deck before the next card is shown.

Run **Review Status** once to add a card-stack icon to the macOS menu bar. Its number shows cards
due now; new cards and unreadable decks are listed inside the menu. The status refreshes every 15
minutes and after creating or grading a card.

## Development

Run these commands from the standalone app directory:

```bash
npm run lint
npm run fmt:check
npm run typecheck
npm test
npm run build
```

The production build writes all three commands and assets to `dist/`. It does not install the
extension into Raycast; use `npm run dev` to run it in the host. The included GitHub Actions
workflow installs from the lockfile, runs these checks, and uploads `dist/`.

While the app remains in the monorepo, use `bun run raycast:dev`, `raycast:test`,
`raycast:typecheck`, and `raycast:build` from the repository root. Those wrappers build the
libraries before running the app's local commands. Run `bun run watch:libraries` alongside
development when changing library source.

From the monorepo root, `bun run check:raycast` copies this app outside the workspace, installs
its built library archives with npm, and runs all checks plus the production build. To retain a
standalone copy with a portable lockfile and library archives, pass a new destination:

```bash
bun run check:raycast --output dist/raycast
```

The export can become a separate repository. It refuses to overwrite an existing destination.
When the libraries are published, replace the `file:vendor/...` dependencies with their released
versions and regenerate the lockfile; the app's source and build commands need no changes.
