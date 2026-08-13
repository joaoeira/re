# re for Raycast

Create and review Q&A and cloze cards directly in re Markdown decks.

## Setup

Run the extension in development mode:

```bash
bun run raycast:dev
```

The first time you open **Create Card**, Raycast asks for the **Decks Folder**. Choose the
directory that contains your re Markdown decks. The extension scans that directory recursively
and respects `.reignore`.

Submit a card with `⌘ ↵`. By default the form remains open and clears the card fields after a
successful write. Enable **Close Raycast After Creating a Card** in the extension preferences if
you want a successful submission to close Raycast instead.

Open **Review Cards** to build one shuffled queue from all new and due cards in the configured
folder. Press `↵` to reveal a card and `↵` again to grade it **Good**. Use `⌘ 1`, `⌘ 2`, `⌘ 3`,
or `⌘ 4` to grade it **Again**, **Hard**, **Good**, or **Easy**. Each grade updates the card's
scheduling metadata in its original deck before the next card is shown.

## Development

```bash
bun run raycast:test
bun run raycast:typecheck
bun run raycast:build
```
