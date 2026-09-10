import * as Path from "effect/Path";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  InvalidDeckImagePath,
  isPathWithinRoot,
  resolveDeckImagePath,
} from "../../src/workspace/index.js";

const runResolve = (options: {
  readonly rootPath: string;
  readonly deckPath: string;
  readonly imagePath: string;
}) => resolveDeckImagePath(options).pipe(Effect.provide(Path.layer), Effect.runPromise);

const runResolveResult = (options: {
  readonly rootPath: string;
  readonly deckPath: string;
  readonly imagePath: string;
}) =>
  resolveDeckImagePath(options).pipe(Effect.result, Effect.provide(Path.layer), Effect.runPromise);

const runWithinRoot = (rootPath: string, targetPath: string) =>
  isPathWithinRoot(rootPath, targetPath).pipe(Effect.provide(Path.layer), Effect.runPromise);

describe("imagePaths", () => {
  describe("isPathWithinRoot", () => {
    it("returns true when target is inside the workspace root", async () => {
      const result = await runWithinRoot("/workspace", "/workspace/decks/biology/cell.md");
      expect(result).toBe(true);
    });

    it("returns false when target is outside the workspace root", async () => {
      const result = await runWithinRoot("/workspace", "/other/decks/biology/cell.md");
      expect(result).toBe(false);
    });
  });

  describe("resolveDeckImagePath", () => {
    it("resolves a deck-relative image path inside the workspace root", async () => {
      const result = await runResolve({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "../../.re/assets/mitochondrion.png",
      });

      expect(result).toEqual({
        absolutePath: "/workspace/.re/assets/mitochondrion.png",
        workspaceRelativePath: ".re/assets/mitochondrion.png",
      });
    });

    it("normalizes dot segments in image paths", async () => {
      const result = await runResolve({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "./images/../images/diagram.png",
      });

      expect(result).toEqual({
        absolutePath: "/workspace/decks/biology/images/diagram.png",
        workspaceRelativePath: "decks/biology/images/diagram.png",
      });
    });

    it("accepts workspace-relative names that start with .. but stay inside root", async () => {
      const result = await runResolve({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "../../..hidden/diagram.png",
      });

      expect(result).toEqual({
        absolutePath: "/workspace/..hidden/diagram.png",
        workspaceRelativePath: "..hidden/diagram.png",
      });
    });

    it("preserves spaces and unicode characters in valid image paths", async () => {
      const result = await runResolve({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "../../.re/assets/célula diagram.png",
      });

      expect(result).toEqual({
        absolutePath: "/workspace/.re/assets/célula diagram.png",
        workspaceRelativePath: ".re/assets/célula diagram.png",
      });
    });

    it("rejects empty image paths", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "   ",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(InvalidDeckImagePath);
        expect(result.failure.reason).toBe("empty_path");
      }
    });

    it("rejects absolute image paths", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "/tmp/mitochondrion.png",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("absolute_path_not_allowed");
      }
    });

    it("rejects image paths with URI schemes", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "https://example.com/mitochondrion.png",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("scheme_not_allowed");
      }
    });

    it("rejects image paths with query strings", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "images/diagram.png?size=2x",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("query_not_allowed");
      }
    });

    it("rejects image paths with fragments", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "images/diagram.png#mitochondria",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("fragment_not_allowed");
      }
    });

    it("rejects deck paths outside the workspace root", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "/outside/decks/biology/cell.md",
        imagePath: "images/diagram.png",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("deck_outside_root");
      }
    });

    it("rejects resolved image paths outside the workspace root", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "../../../secret.png",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("path_outside_root");
      }
    });

    it("rejects relative workspace roots", async () => {
      const result = await runResolveResult({
        rootPath: "workspace",
        deckPath: "/workspace/decks/biology/cell.md",
        imagePath: "images/diagram.png",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("absolute_root_path_required");
      }
    });

    it("rejects relative deck paths", async () => {
      const result = await runResolveResult({
        rootPath: "/workspace",
        deckPath: "decks/biology/cell.md",
        imagePath: "images/diagram.png",
      });

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("absolute_deck_path_required");
      }
    });
  });
});
