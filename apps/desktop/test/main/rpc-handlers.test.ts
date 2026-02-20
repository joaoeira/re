import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { parseFile } from "@re/core";
import { NodeServicesLive } from "@main/effect/node-services";
import { createAppRpcHandlers } from "@main/rpc/handlers";
import { makeSettingsRepository } from "@main/settings/repository";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import { WorkspaceRootNotFound as SnapshotWorkspaceRootNotFound } from "@re/workspace";
import {
  DEFAULT_SETTINGS,
  WorkspaceRootNotFound as SettingsWorkspaceRootNotFound,
} from "@shared/settings";

const stubSettingsRepository: SettingsRepository = {
  getSettings: () => Effect.succeed(DEFAULT_SETTINGS),
  setWorkspaceRootPath: ({ rootPath }) =>
    Effect.succeed({
      ...DEFAULT_SETTINGS,
      workspace: {
        rootPath,
      },
    }),
};

const stubWatcher: WorkspaceWatcher = {
  start: () => {},
  stop: () => {},
};

const handlers = createAppRpcHandlers(stubSettingsRepository, stubWatcher);

const createHandlers = async (settingsFilePath: string, watcher?: WorkspaceWatcher) =>
  Effect.gen(function* () {
    const repository = yield* makeSettingsRepository({ settingsFilePath });
    return createAppRpcHandlers(repository, watcher ?? stubWatcher);
  }).pipe(Effect.provide(NodeServicesLive), Effect.runPromise);

describe("main rpc handlers", () => {
  it("returns bootstrap payload", async () => {
    const result = await Effect.runPromise(handlers.GetBootstrapData({}));

    expect(result.appName).toBe("re Desktop");
    expect(result.message).toContain("typed Effect RPC");
  });

  it("parses markdown and returns item/card counts", async () => {
    const markdown = `---
title: Sample
---

<!--@ card-a 0 0 0 0-->
Question one
---
Answer one

<!--@ card-b 0 0 0 0-->
Question two
---
Answer two
`;

    const result = await Effect.runPromise(handlers.ParseDeckPreview({ markdown }));

    expect(result).toEqual({
      items: 2,
      cards: 2,
    });
  });

  it("returns parser tagged errors through the domain error channel", async () => {
    const invalidMarkdown = `<!--@ bad-card 0 0 9 0-->
Broken card content`;

    const exit = await Effect.runPromiseExit(
      handlers.ParseDeckPreview({ markdown: invalidMarkdown }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected ParseDeckPreview to fail.");
    }

    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "None") {
      throw new Error("Expected a domain failure, but received a defect or interruption.");
    }

    expect(failure.value._tag).toBe("InvalidFieldValue");
    if (failure.value._tag === "InvalidFieldValue") {
      expect(failure.value.line).toBe(1);
      expect(failure.value.field).toBe("metadata");
      expect(failure.value.value).toContain("bad-card");
    }
  });

  it("scans decks and returns full deck entries", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-scan-"));

    try {
      await fs.mkdir(path.join(rootPath, "nested"), { recursive: true });
      await fs.writeFile(path.join(rootPath, "root.md"), "# root", "utf8");
      await fs.writeFile(path.join(rootPath, "nested/child.md"), "# child", "utf8");
      await fs.writeFile(path.join(rootPath, "nested/ignore.txt"), "not a deck", "utf8");

      const result = await Effect.runPromise(handlers.ScanDecks({ rootPath }));

      expect(result.rootPath).toBe(rootPath);
      expect(result.decks).toEqual([
        {
          absolutePath: path.join(rootPath, "nested/child.md"),
          relativePath: "nested/child.md",
          name: "child",
        },
        {
          absolutePath: path.join(rootPath, "root.md"),
          relativePath: "root.md",
          name: "root",
        },
      ]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns workspace snapshot with mixed deck statuses", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-snapshot-"));
    const okDeckPath = path.join(rootPath, "1-ok.md");
    const readErrorDeckPath = path.join(rootPath, "2-read-error.md");
    const parseErrorDeckPath = path.join(rootPath, "3-parse-error.md");

    try {
      await fs.writeFile(
        okDeckPath,
        `<!--@ card-a 0 0 0 0-->
Question
---
Answer
`,
        "utf8",
      );
      await fs.writeFile(readErrorDeckPath, "# unreadable", "utf8");
      await fs.writeFile(parseErrorDeckPath, "<!--@ bad 0 0 9 0-->", "utf8");
      await fs.chmod(readErrorDeckPath, 0o000);

      const result = await Effect.runPromise(
        handlers.GetWorkspaceSnapshot({
          rootPath,
          options: {
            includeHidden: false,
            extraIgnorePatterns: [],
          },
        }),
      );

      expect(result.rootPath).toBe(rootPath);
      expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);
      expect(result.decks).toHaveLength(3);
      expect(result.decks.map((deck) => deck.status)).toEqual(["ok", "read_error", "parse_error"]);

      const okDeck = result.decks.find((deck) => deck.name === "1-ok");
      expect(okDeck).toBeDefined();
      if (okDeck?.status === "ok") {
        expect(okDeck.totalCards).toBe(1);
        expect(okDeck.dueCards).toBe(0);
        expect(okDeck.stateCounts).toEqual({
          new: 1,
          learning: 0,
          review: 0,
          relearning: 0,
        });
      } else {
        throw new Error("Expected 1-ok deck to succeed.");
      }
    } finally {
      await fs.chmod(readErrorDeckPath, 0o644).catch(() => undefined);
      await fs.rm(rootPath, { recursive: true, force: true });
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

  it("returns typed root errors for workspace snapshot", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-snapshot-error-"));
    const nonexistentRoot = path.join(rootPath, "missing");

    try {
      const exit = await Effect.runPromiseExit(
        handlers.GetWorkspaceSnapshot({
          rootPath: nonexistentRoot,
          options: {
            includeHidden: false,
            extraIgnorePatterns: [],
          },
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetWorkspaceSnapshot to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SnapshotWorkspaceRootNotFound);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns default settings when settings file is missing", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-settings-"));
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      const handlers = await createHandlers(settingsFilePath);
      const result = await Effect.runPromise(handlers.GetSettings({}));

      expect(result).toEqual({
        settingsVersion: 1,
        workspace: { rootPath: null },
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("sets workspace root path and returns updated settings", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-settings-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });

      const handlers = await createHandlers(settingsFilePath);
      const result = await Effect.runPromise(
        handlers.SetWorkspaceRootPath({ rootPath: workspacePath }),
      );

      expect(result.workspace.rootPath).toBe(workspacePath);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("returns typed domain error for invalid workspace root path", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-settings-"));
    const settingsFilePath = path.join(rootPath, "settings.json");
    const nonexistentPath = path.join(rootPath, "missing");

    try {
      const handlers = await createHandlers(settingsFilePath);
      const exit = await Effect.runPromiseExit(
        handlers.SetWorkspaceRootPath({ rootPath: nonexistentPath }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected SetWorkspaceRootPath to fail.");
      }

      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(SettingsWorkspaceRootNotFound);
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });

  it("starts watcher on SetWorkspaceRootPath success and stops on null", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-watcher-"));
    const workspacePath = path.join(rootPath, "workspace");
    const settingsFilePath = path.join(rootPath, "settings.json");

    try {
      await fs.mkdir(workspacePath, { recursive: true });

      const spyWatcher: WorkspaceWatcher = {
        start: vi.fn(),
        stop: vi.fn(),
      };
      const handlers = await createHandlers(settingsFilePath, spyWatcher);

      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: workspacePath }));

      expect(spyWatcher.start).toHaveBeenCalledWith(workspacePath);
      expect(spyWatcher.stop).not.toHaveBeenCalled();

      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath: null }));

      expect(spyWatcher.stop).toHaveBeenCalled();
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
    }
  });
});
