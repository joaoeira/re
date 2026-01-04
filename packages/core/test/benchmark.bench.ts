/**
 * Benchmark results history
 * -------------------------
 *
 * 2026-01-04 (multi-card support, Item.cards: ItemMetadata[])
 * Machine: Apple M-series
 *
 * parseFile:
 *   10 items:    22,497 ops/sec (0.044ms mean)
 *   100 items:    2,914 ops/sec (0.343ms mean)
 *   1000 items:     269 ops/sec (3.723ms mean)
 *
 * serializeFile:
 *   10 items:   387,246 ops/sec (0.003ms mean)
 *   100 items:   39,010 ops/sec (0.026ms mean)
 *   1000 items:   3,881 ops/sec (0.258ms mean)
 *
 * round-trip:
 *   10 items:   25,417 ops/sec (0.039ms mean)
 *   100 items:   2,674 ops/sec (0.374ms mean)
 *   1000 items:    239 ops/sec (4.182ms mean)
 *
 * createMetadata:
 *   single:      8,502,603 ops/sec
 *   batch of 100:  100,734 ops/sec
 *
 * build file (create 100 items + serialize):
 *   47,213 ops/sec (0.021ms mean)
 */

import { bench, describe } from "vitest";
import { Effect } from "effect";
import { parseFile } from "../src/parser/index.ts";
import { serializeFile } from "../src/serializer/index.ts";
import { createMetadata } from "../src/create.ts";
import type { ParsedFile, Item } from "../src/types.ts";

// Generate test files of various sizes
const generateFile = (itemCount: number): string => {
  let content = "---\ntitle: Benchmark Test\n---\n\n";
  for (let i = 0; i < itemCount; i++) {
    const hasReview = i % 2 === 0;
    const metadata = hasReview
      ? `<!--@ item${i} ${(i * 0.5).toFixed(1)} ${(i * 0.3).toFixed(
          1
        )} 2 0 2025-01-04T10:30:00.000Z-->`
      : `<!--@ item${i} 0 0 0 0-->`;
    content += `${metadata}\nQuestion ${i}: What is ${i} + ${i}?\n---\nAnswer: ${
      i * 2
    }\n\n`;
  }
  return content;
};

const smallFile = generateFile(10);
const mediumFile = generateFile(100);
const largeFile = generateFile(1000);

// Pre-parsed files for serialization benchmarks
let parsedSmall: ParsedFile;
let parsedMedium: ParsedFile;
let parsedLarge: ParsedFile;

// Parse once for serialization benchmarks
Effect.runSync(
  parseFile(smallFile).pipe(
    Effect.tap((f) =>
      Effect.sync(() => {
        parsedSmall = f;
      })
    )
  )
);
Effect.runSync(
  parseFile(mediumFile).pipe(
    Effect.tap((f) =>
      Effect.sync(() => {
        parsedMedium = f;
      })
    )
  )
);
Effect.runSync(
  parseFile(largeFile).pipe(
    Effect.tap((f) =>
      Effect.sync(() => {
        parsedLarge = f;
      })
    )
  )
);

describe("parseFile", () => {
  bench("10 items", () => {
    Effect.runSync(parseFile(smallFile));
  });

  bench("100 items", () => {
    Effect.runSync(parseFile(mediumFile));
  });

  bench("1000 items", () => {
    Effect.runSync(parseFile(largeFile));
  });
});

describe("serializeFile", () => {
  bench("10 items", () => {
    serializeFile(parsedSmall);
  });

  bench("100 items", () => {
    serializeFile(parsedMedium);
  });

  bench("1000 items", () => {
    serializeFile(parsedLarge);
  });
});

describe("round-trip", () => {
  bench("10 items", () => {
    const parsed = Effect.runSync(parseFile(smallFile));
    serializeFile(parsed);
  });

  bench("100 items", () => {
    const parsed = Effect.runSync(parseFile(mediumFile));
    serializeFile(parsed);
  });

  bench("1000 items", () => {
    const parsed = Effect.runSync(parseFile(largeFile));
    serializeFile(parsed);
  });
});

describe("createMetadata", () => {
  bench("single", () => {
    createMetadata();
  });

  bench("batch of 100", () => {
    for (let i = 0; i < 100; i++) {
      createMetadata();
    }
  });
});

// Simulate building a file programmatically
describe("build file", () => {
  bench("create 100 items and serialize", () => {
    const items: Item[] = [];
    for (let i = 0; i < 100; i++) {
      items.push({
        cards: [createMetadata()],
        content: `Question ${i}\n---\nAnswer ${i}\n`,
      });
    }
    const file: ParsedFile = { preamble: "", items };
    serializeFile(file);
  });
});
