import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { SystemError } from "@effect/platform/Error";
import {
  DeckParser,
  DeckParserLive,
  DeckReadError,
  DeckParseError,
} from "../../src/services/DeckParser";

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
    if (path === "/empty.md")
      return Effect.succeed("# Just a title\n\nNo cards here.");
    if (path === "/invalid.md") return Effect.succeed("<!--@ bad metadata-->");
    return Effect.fail(
      new SystemError({
        reason: "NotFound",
        module: "FileSystem",
        method: "readFileString",
        pathOrDescriptor: path,
      })
    );
  },
});

const TestLayer = DeckParserLive.pipe(Layer.provide(MockFileSystem));

describe("DeckParser", () => {
  describe("parse", () => {
    it("parses valid deck successfully", async () => {
      const result = await Effect.gen(function* () {
        const parser = yield* DeckParser;
        return yield* parser.parse("/valid.md");
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.path).toBe("/valid.md");
      expect(result.name).toBe("valid");
      expect(result.file.items.length).toBe(2);
      expect(result.file.items[0]?.cards[0]?.id).toBe("abc123");
    });

    it("returns DeckReadError for missing files", async () => {
      const result = await Effect.gen(function* () {
        const parser = yield* DeckParser;
        return yield* parser.parse("/missing.md").pipe(Effect.either);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(DeckReadError);
        expect(result.left.path).toBe("/missing.md");
      }
    });

    it("returns DeckParseError for invalid files", async () => {
      const result = await Effect.gen(function* () {
        const parser = yield* DeckParser;
        return yield* parser.parse("/invalid.md").pipe(Effect.either);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(DeckParseError);
        expect(result.left.path).toBe("/invalid.md");
      }
    });
  });

  describe("parseAll", () => {
    it("parses multiple decks, filtering out failures", async () => {
      const result = await Effect.gen(function* () {
        const parser = yield* DeckParser;
        return yield* parser.parseAll([
          "/valid.md",
          "/missing.md",
          "/invalid.md",
        ]);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      // Only valid.md should be returned
      expect(result.length).toBe(1);
      expect(result[0]?.path).toBe("/valid.md");
    });

    it("returns empty array when all fail", async () => {
      const result = await Effect.gen(function* () {
        const parser = yield* DeckParser;
        return yield* parser.parseAll(["/missing.md", "/invalid.md"]);
      }).pipe(Effect.provide(TestLayer), Effect.runPromise);

      expect(result.length).toBe(0);
    });
  });
});
