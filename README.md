# re

Metadata utilities for spaced repetition flashcard files. Parse, serialize, and manipulate markdown files with embedded scheduling metadata.

## Format

Cards are stored in markdown files with metadata in HTML comments:

```markdown
---
title: My Flashcards
---

<!--@ abc123 5.2 4.3 2 0 2025-01-04T10:30:00.000Z-->

## What is the capital of France?

Paris

<!--@ def456 0 0 0 0-->

## What is 2 + 2?

4
```

Metadata format: `<!--@ <id> <stability> <difficulty> <state> <steps> [lastReview]-->`

| Field      | Type     | Description                                         |
| ---------- | -------- | --------------------------------------------------- |
| id         | string   | Unique identifier (nanoid)                          |
| stability  | number   | FSRS stability parameter                            |
| difficulty | number   | FSRS difficulty parameter                           |
| state      | 0-3      | 0=New, 1=Learning, 2=Review, 3=Relearning           |
| steps      | number   | Learning steps completed                            |
| lastReview | ISO 8601 | Last review timestamp (optional, requires timezone) |

## Installation

```bash
bun add @re/core
```

## Usage

```typescript
import { Effect } from "effect";
import { parseFile, serializeFile, createMetadata, State } from "@re/core";

// Parse a file
const content = await Bun.file("cards.md").text();
const parsed = Effect.runSync(parseFile(content));

console.log(parsed.preamble); // Content before first item
console.log(parsed.items.length); // Number of items
console.log(parsed.items[0].cards[0].id); // First card's ID
console.log(parsed.items[0].content);

// Modify a card's metadata after review
const updated = {
  ...parsed,
  items: parsed.items.map((item, i) =>
    i === 0
      ? {
          ...item,
          cards: item.cards.map((card, j) =>
            j === 0
              ? {
                  ...card,
                  state: State.Review,
                  lastReview: new Date(),
                }
              : card,
          ),
        }
      : item,
  ),
};

// Serialize back to string
const output = serializeFile(updated);
await Bun.write("cards.md", output);

// Create a new item with one card
const newItem = {
  cards: [createMetadata()],
  content: "New question\n---\nNew answer\n",
};
```

## API

### Parsing

```typescript
parseFile(content: string): Effect<ParsedFile, MetadataParseError>
```

Returns `ParsedFile` with:

- `preamble`: Content before first card (preserved byte-perfect)
- `items`: Array of `Item` (metadata + content)

### Serialization

```typescript
serializeFile(file: ParsedFile): string
serializeMetadata(metadata: ItemMetadata): string
```

Round-trip guarantees:

- Preamble and content: byte-perfect
- Metadata: canonicalized (single spaces, LF endings, UTC timestamps)
- Numeric precision preserved via `NumericField.raw`

### Creation

```typescript
generateId(): ItemId                           // New nanoid
createMetadata(): ItemMetadata                 // Fresh card metadata
createMetadataWithId(id: ItemId): ItemMetadata // With specific ID
numericField(value: number): NumericField      // Create numeric field
```

### Types

```typescript
interface ParsedFile {
  readonly preamble: string;
  readonly items: readonly Item[];
}

interface Item {
  readonly cards: readonly ItemMetadata[]; // Multiple cards can share content
  readonly content: string;
}

interface ItemMetadata {
  readonly id: ItemId;
  readonly stability: NumericField;
  readonly difficulty: NumericField;
  readonly state: State;
  readonly learningSteps: number;
  readonly lastReview: Date | null;
}

interface NumericField {
  readonly value: number; // For computation
  readonly raw: string; // For serialization (preserves "5.20")
}

const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 } as const;
```

Multi-card items (e.g., cloze deletions) use consecutive metadata lines:

```markdown
<!--@ card1 0 0 0 0-->
<!--@ card2 0 0 0 0-->

The atomic number of [carbon] is [6].
```

This parses as one item with two cards sharing the same content.

### Errors

All parse errors are tagged for pattern matching:

```typescript
import { ParseError, InvalidMetadataFormat, InvalidFieldValue } from "@re/core";

Effect.runSync(
  parseFile(content).pipe(
    Effect.catchTags({
      InvalidMetadataFormat: (e) => console.error(`Line ${e.line}: ${e.reason}`),
      InvalidFieldValue: (e) => console.error(`Line ${e.line}: ${e.field} = ${e.value}`),
    }),
  ),
);
```

## Validation

Strict validation on parse:

- Numeric fields: non-negative, no scientific notation, no Infinity
- State: must be 0-3
- Timestamps: ISO 8601 with timezone required (Z or ±HH:MM)
- Calendar dates: Feb 30, Feb 29 in non-leap years, etc. are rejected

## Performance

Benchmarks on M-series Mac:

| Operation  | 1k cards | 10k cards |
| ---------- | -------- | --------- |
| Parse      | ~3.5ms   | ~35ms     |
| Serialize  | ~0.26ms  | ~2.6ms    |
| Round-trip | ~4ms     | ~40ms     |

For typical review sessions (< 10k cards), full file writes on each card update are fast enough (~10-50ms including disk I/O).

## Development

```bash
bun install                          # Install all workspace dependencies
bun run test                         # Run tests in all packages
bun run typecheck                    # Type check all packages

# Or run commands in a specific package
cd packages/core
bun run test        # Run tests
bun run test:watch  # Watch mode
bun run bench       # Run benchmarks
bun run typecheck   # Type check
```
