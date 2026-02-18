import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem, Path } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import { DeckLoader, DeckLoaderLive } from "../../src/services/DeckLoader";
import { DeckManagerLive, SchedulerLive } from "@re/workspace";

const validDeckContent = `---
title: Test
---

<!--@ abc123 5 4.5 2 0 2025-01-01T00:00:00Z-->
Question 1
---
Answer 1

<!--@ def456 0 0 0 0-->
Question 2
---
Answer 2
`;

const MockFileSystem = FileSystem.layerNoop({
  readFileString: (path) => {
    if (path === "/valid.md") return Effect.succeed(validDeckContent);
    if (path === "/empty.md") return Effect.succeed("# Just a title\n\nNo cards here.");
    if (path === "/invalid.md") return Effect.succeed("<!--@ bad metadata-->");
    return Effect.fail(
      new SystemError({
        reason: "NotFound",
        module: "FileSystem",
        method: "readFileString",
        pathOrDescriptor: path,
      }),
    );
  },
});

const MockDeckManager = DeckManagerLive.pipe(
  Layer.provide(Layer.mergeAll(MockFileSystem, Path.layer)),
);

const TestLayer = DeckLoaderLive.pipe(
  Layer.provide(Layer.mergeAll(MockDeckManager, SchedulerLive, Path.layer)),
);

describe("DeckLoader", () => {
  it("loads valid deck with correct stats", async () => {
    const now = new Date("2025-01-10T00:00:00Z");

    const result = await Effect.gen(function* () {
      const loader = yield* DeckLoader;
      return yield* loader.loadDeck("/valid.md", now);
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result.name).toBe("valid");
    expect(result.totalCards).toBe(2);
    expect(result.newCards).toBe(1); // def456 has state 0
    expect(result.dueCards).toBe(1); // abc123 is due (9 days > 5 day stability)
    expect(result.parseError).toBeNull();
  });

  it("handles empty files", async () => {
    const result = await Effect.gen(function* () {
      const loader = yield* DeckLoader;
      return yield* loader.loadDeck("/empty.md", new Date());
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result.isEmpty).toBe(true);
    expect(result.totalCards).toBe(0);
    expect(result.parseError).toBeNull();
  });

  it("handles parse errors gracefully", async () => {
    const result = await Effect.gen(function* () {
      const loader = yield* DeckLoader;
      return yield* loader.loadDeck("/invalid.md", new Date());
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result.isEmpty).toBe(true);
    expect(result.parseError).toBeTruthy();
  });

  it("handles read errors gracefully", async () => {
    const result = await Effect.gen(function* () {
      const loader = yield* DeckLoader;
      return yield* loader.loadDeck("/missing.md", new Date());
    }).pipe(Effect.provide(TestLayer), Effect.runPromise);

    expect(result.isEmpty).toBe(true);
    expect(result.parseError).toBe("Deck not found");
  });
});
