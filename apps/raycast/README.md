# re for Raycast

Create Q&A and cloze cards directly in an existing re Markdown deck.

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

## Development

```bash
bun run raycast:test
bun run raycast:typecheck
bun run raycast:build
```
