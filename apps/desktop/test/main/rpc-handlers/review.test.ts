import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  createNoopReviewAnalyticsRepository,
  type ReviewAnalyticsRepository,
} from "@main/analytics";
import type { ForgePromptRuntime } from "@main/forge/services/prompt-runtime";
import { parseFile } from "@re/core";

import { createHandlersWithOverrides } from "./helpers";

const createReviewPromptRuntime = (
  implementation: (input: {
    readonly sourceCard: {
      readonly cardType: "qa";
      readonly content: {
        readonly question: string;
        readonly answer: string;
      };
    };
    readonly instruction?: string;
  }) => Effect.Effect<
    ReadonlyArray<{ readonly question: string; readonly answer: string }>,
    unknown
  >,
): ForgePromptRuntime =>
  ({
    run: <Input, Output>(_spec: unknown, input: Input) =>
      implementation(
        input as {
          readonly sourceCard: {
            readonly cardType: "qa";
            readonly content: {
              readonly question: string;
              readonly answer: string;
            };
          };
          readonly instruction?: string;
        },
      ).pipe(
        Effect.map(
          (permutations) =>
            ({
              output: {
                permutations,
              } as Output,
              rawText: JSON.stringify({ permutations }),
              metadata: {
                promptId: "review/generate-permutations",
                promptVersion: "1",
                model: "test:model",
                attemptCount: 1,
                promptHash: "test-hash",
                outputChars: 0,
              },
            }) as const,
        ),
      ),
  }) as ForgePromptRuntime;

describe("review handlers", () => {
  it("rewrites relative image markdown to file URLs for review content", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-image-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "images.md");
    const assetPath = path.join(
      rootPath,
      ".re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png",
    );

    try {
      await fs.mkdir(path.dirname(assetPath), { recursive: true });
      await fs.writeFile(assetPath, new Uint8Array([1, 2, 3, 4]));
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
Question
![](.re/assets/9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a.png)
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const card = await Effect.runPromise(
        handlers.GetCardContent({
          deckPath,
          cardId: "qa-card",
          cardIndex: 0,
        }),
      );

      expect(card.prompt).toContain("Question");
      expect(card.prompt).toContain("re-asset://asset/.re/assets/");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
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
          reviewEntryId: scheduled.reviewEntryId,
          expectedCurrentCardFingerprint: scheduled.expectedCurrentCardFingerprint,
          previousCardFingerprint: scheduled.previousCardFingerprint,
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

  it("returns a QA assistant source card for the current review card", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-source-card-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
Question
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const sourceCard = await Effect.runPromise(
        handlers.GetReviewAssistantSourceCard({
          deckPath,
          cardId: "qa-card",
          cardIndex: 0,
        }),
      );

      expect(sourceCard.sourceCard.cardType).toBe("qa");
      expect(sourceCard.sourceCard.content).toEqual({
        question: "Question",
        answer: "Answer",
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns assistant_unsupported_card_type for cloze source card reads", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-source-cloze-"));
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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.GetReviewAssistantSourceCard({
          deckPath,
          cardId: "cloze-card",
          cardIndex: 0,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetReviewAssistantSourceCard to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("assistant_unsupported_card_type");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("generates normalized permutations for a QA review card", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-generate-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
Question
---
Answer
`,
        "utf8",
      );

      const promptRuntime = createReviewPromptRuntime(() =>
        Effect.succeed([
          { question: "  Question  ", answer: "  Answer  " },
          { question: "Variant question", answer: "Variant answer" },
          { question: "Variant question", answer: "Variant answer" },
          { question: "   ", answer: "missing" },
        ]),
      );

      const handlers = await createHandlersWithOverrides(settingsFilePath, {
        forgePromptRuntime: promptRuntime,
      });
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ReviewGeneratePermutations({
          deckPath,
          cardId: "qa-card",
          cardIndex: 0,
        }),
      );

      expect(result.permutations).toHaveLength(1);
      expect(result.permutations[0]?.question).toBe("Variant question");
      expect(result.permutations[0]?.answer).toBe("Variant answer");
      expect(result.permutations[0]?.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("maps prompt runtime failures to review_permutation_generation_error", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-generate-fail-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
Question
---
Answer
`,
        "utf8",
      );

      const promptRuntime = createReviewPromptRuntime(() =>
        Effect.fail(new Error("model unavailable")),
      );

      const handlers = await createHandlersWithOverrides(settingsFilePath, {
        forgePromptRuntime: promptRuntime,
      });
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.ReviewGeneratePermutations({
          deckPath,
          cardId: "qa-card",
          cardIndex: 0,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ReviewGeneratePermutations to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("review_permutation_generation_error");
      }
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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
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

  it("returns read_error when deck cannot be read in GetReviewAssistantSourceCard", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-source-read-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "unreadable.md");

    try {
      await fs.mkdir(deckPath);

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.GetReviewAssistantSourceCard({
          deckPath,
          cardId: "any-card",
          cardIndex: 0,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetReviewAssistantSourceCard to fail.");
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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
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

  it("returns card_index_out_of_bounds when ReviewGeneratePermutations receives an invalid index", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-generate-oob-"));
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

      const handlers = await createHandlersWithOverrides(settingsFilePath, {
        forgePromptRuntime: createReviewPromptRuntime(() => Effect.succeed([])),
      });
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.ReviewGeneratePermutations({
          deckPath,
          cardId: "cloze-card",
          cardIndex: 1,
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ReviewGeneratePermutations to fail.");
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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
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

  it("returns undo_conflict when card metadata diverges before undo", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "conflict.md");

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

      const handlers = await createHandlersWithOverrides(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const firstSchedule = await Effect.runPromise(
        handlers.ScheduleReview({
          deckPath,
          cardId: "review-card",
          grade: 2,
        }),
      );

      await Effect.runPromise(
        handlers.ScheduleReview({
          deckPath,
          cardId: "review-card",
          grade: 1,
        }),
      );

      const undoExit = await Effect.runPromiseExit(
        handlers.UndoReview({
          deckPath,
          cardId: "review-card",
          previousCard: firstSchedule.previousCard,
          reviewEntryId: firstSchedule.reviewEntryId,
          expectedCurrentCardFingerprint: firstSchedule.expectedCurrentCardFingerprint,
          previousCardFingerprint: firstSchedule.previousCardFingerprint,
        }),
      );

      expect(Exit.isFailure(undoExit)).toBe(true);
      if (Exit.isSuccess(undoExit)) {
        throw new Error("Expected UndoReview to fail with conflict.");
      }

      const failure = Cause.failureOption(undoExit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("undo_conflict");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns undo_safety_unavailable when intent journal persistence fails", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-review-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "undo-safety.md");

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

      const failingAnalytics: ReviewAnalyticsRepository = {
        ...createNoopReviewAnalyticsRepository(),
        enabled: true,
        recordSchedule: () => Effect.succeed(1),
        persistIntent: () => Effect.fail(new Error("journal unavailable")),
      };

      const handlers = await createHandlersWithOverrides(settingsFilePath, {
        analyticsRepository: failingAnalytics,
      });
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const scheduled = await Effect.runPromise(
        handlers.ScheduleReview({
          deckPath,
          cardId: "review-card",
          grade: 2,
        }),
      );

      const undoExit = await Effect.runPromiseExit(
        handlers.UndoReview({
          deckPath,
          cardId: "review-card",
          previousCard: scheduled.previousCard,
          reviewEntryId: scheduled.reviewEntryId,
          expectedCurrentCardFingerprint: scheduled.expectedCurrentCardFingerprint,
          previousCardFingerprint: scheduled.previousCardFingerprint,
        }),
      );

      expect(Exit.isFailure(undoExit)).toBe(true);
      if (Exit.isSuccess(undoExit)) {
        throw new Error("Expected UndoReview to fail.");
      }

      const failure = Cause.failureOption(undoExit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("undo_safety_unavailable");
      }

      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items[0]!.cards[0]!.state).not.toBe(scheduled.previousCard.state);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });
});
