import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { parseFile } from "@re/core";

import { createHandlers } from "./helpers";

describe("review handlers", () => {
  it("builds a review queue and returns QA card content", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
What is the capital of France?
---
Paris
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const queue = await Effect.runPromise(
        handlers.BuildReviewQueue({
          deckPaths: [deckPath],
          rootPath,
        }),
      );

      expect(queue.items).toHaveLength(1);
      expect(queue.totalNew).toBe(1);
      expect(queue.totalDue).toBe(0);
      expect(queue.items[0]!.deckPath).toBe(deckPath);
      expect(queue.items[0]!.cardId).toBe("qa-card");
      expect(queue.items[0]!.deckName).toBe("qa");

      const card = await Effect.runPromise(
        handlers.GetCardContent({
          deckPath,
          cardId: queue.items[0]!.cardId,
          cardIndex: queue.items[0]!.cardIndex,
        }),
      );

      expect(card.cardType).toBe("qa");
      expect(card.prompt).toContain("capital of France");
      expect(card.reveal).toContain("Paris");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("schedules a review and undo restores previous card metadata", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "review.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ review-card 0 0 0 0-->
Prompt
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const scheduled = await Effect.runPromise(
        handlers.ScheduleReview({
          deckPath,
          cardId: "review-card",
          grade: 2,
        }),
      );

      expect(scheduled.previousCard.state).toBe(0);
      expect(scheduled.previousCard.lastReview).toBeNull();
      expect(scheduled.previousCard.due).toBeNull();

      const afterScheduleMarkdown = await fs.readFile(deckPath, "utf8");
      const afterSchedule = await Effect.runPromise(parseFile(afterScheduleMarkdown));
      expect(afterSchedule.items[0]!.cards[0]!.state).not.toBe(0);

      await Effect.runPromise(
        handlers.UndoReview({
          deckPath,
          cardId: "review-card",
          previousCard: scheduled.previousCard,
        }),
      );

      const afterUndoMarkdown = await fs.readFile(deckPath, "utf8");
      const afterUndo = await Effect.runPromise(parseFile(afterUndoMarkdown));
      const restoredCard = afterUndo.items[0]!.cards[0]!;

      expect(restoredCard.state).toBe(scheduled.previousCard.state);
      expect(restoredCard.learningSteps).toBe(scheduled.previousCard.learningSteps);
      expect(restoredCard.lastReview).toEqual(scheduled.previousCard.lastReview);
      expect(restoredCard.due).toEqual(scheduled.previousCard.due);
      expect(restoredCard.stability.raw).toBe(scheduled.previousCard.stability.raw);
      expect(restoredCard.difficulty.raw).toBe(scheduled.previousCard.difficulty.raw);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns not_found when card id does not exist", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ existing-card 0 0 0 0-->
Prompt
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.GetCardContent({
          deckPath,
          cardId: "missing-card",
          cardIndex: 0,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetCardContent to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("not_found");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns parse_error when deck parsing fails in GetCardContent", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "bad.md");

    try {
      await fs.writeFile(deckPath, "<!--@ bad 0 0 9 0-->", "utf8");

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.GetCardContent({
          deckPath,
          cardId: "bad",
          cardIndex: 0,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetCardContent to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("parse_error");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns read_error when deck cannot be read in GetCardContent", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "unreadable.md");

    try {
      await fs.mkdir(deckPath);

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.GetCardContent({
          deckPath,
          cardId: "any-card",
          cardIndex: 0,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetCardContent to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("read_error");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns card_index_out_of_bounds when index exceeds inferred cards", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "cloze.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ cloze-card 0 0 0 0-->
The capital of France is {{c1::Paris}}.
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.GetCardContent({
          deckPath,
          cardId: "cloze-card",
          cardIndex: 1,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetCardContent to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("card_index_out_of_bounds");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("rejects deck paths outside workspace root", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const outsideDeckPath = path.join(tmpdir(), "outside-deck.md");

    try {
      await fs.writeFile(outsideDeckPath, "# outside", "utf8");

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.BuildReviewQueue({
          deckPaths: [outsideDeckPath],
          rootPath,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected BuildReviewQueue to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("review_operation_error");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
      await fs.rm(outsideDeckPath, { force: true });
    }
  });
});
