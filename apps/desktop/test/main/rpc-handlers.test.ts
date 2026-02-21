import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import type { IpcMainHandle } from "electron-effect-rpc/types";
import { describe, expect, it, vi } from "vitest";

import { parseFile } from "@re/core";
import type { EditorWindowParams } from "@main/editor-window";
import { NodeServicesLive } from "@main/effect/node-services";
import { createAppRpcHandlers } from "@main/rpc/handlers";
import { makeSettingsRepository } from "@main/settings/repository";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import { WorkspaceRootNotFound as SnapshotWorkspaceRootNotFound } from "@re/workspace";
import type { AppContract } from "@shared/rpc/contracts";
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

const noOpPublish = ((..._args: [unknown, unknown]) => Effect.void) as IpcMainHandle<AppContract>["publish"];

const handlers = createAppRpcHandlers(stubSettingsRepository, stubWatcher).handlers;

const createHandlers = async (
  settingsFilePath: string,
  watcher?: WorkspaceWatcher,
  publish?: IpcMainHandle<AppContract>["publish"],
  openEditorWindow?: (params: EditorWindowParams) => void,
) =>
  Effect.gen(function* () {
    const repository = yield* makeSettingsRepository({ settingsFilePath });
    return createAppRpcHandlers(
      repository,
      watcher ?? stubWatcher,
      publish ?? noOpPublish,
      openEditorWindow,
    ).handlers;
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

  it("appends a new QA item", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-append-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "append.md");
    const publishEvents: Array<{ name: string; payload: unknown }> = [];

    try {
      await fs.writeFile(deckPath, "", "utf8");

      const publish = ((event, payload) =>
        Effect.sync(() => {
          publishEvents.push({ name: event.name, payload });
        })) as IpcMainHandle<AppContract>["publish"];

      const handlers = await createHandlers(settingsFilePath, undefined, publish);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.AppendItem({
          deckPath,
          content: "Question\n---\nAnswer",
          cardType: "qa",
        }),
      );

      expect(result.cardIds).toHaveLength(1);
      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.cards).toHaveLength(1);
      expect(parsed.items[0]!.cards[0]!.id).toBe(result.cardIds[0]);
      expect(publishEvents.some((entry) => entry.name === "CardEdited")).toBe(false);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns item content and type for edit mode", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-get-item-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "item.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ card-a 0 0 0 0-->
Question
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const item = await Effect.runPromise(
        handlers.GetItemForEdit({
          deckPath,
          cardId: "card-a",
        }),
      );

      expect(item.cardType).toBe("qa");
      expect(item.cardIds).toEqual(["card-a"]);
      expect(item.content).toContain("Question");
      expect(item.content).toContain("Answer");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("preserves cloze metadata by cloze index during ReplaceItem", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-cloze-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "cloze.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ c1 0 0 0 0-->
<!--@ c2 0 0 0 0-->
<!--@ c3 0 0 0 0-->
The {{c1::first}} {{c2::second}} {{c3::third}}.
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "c1",
          cardType: "cloze",
          content: "The {{c1::first}} {{c3::third}}.",
        }),
      );

      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.cards.map((card) => card.id)).toEqual(["c1", "c3"]);
      expect(result.cardIds).toEqual(["c1", "c3"]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("publishes CardEdited after ReplaceItem", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-event-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "event.md");
    const publishEvents: Array<{ name: string; payload: unknown }> = [];

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
Prompt
---
Answer
`,
        "utf8",
      );

      const publish = ((event, payload) =>
        Effect.sync(() => {
          publishEvents.push({ name: event.name, payload });
        })) as IpcMainHandle<AppContract>["publish"];

      const handlers = await createHandlers(settingsFilePath, undefined, publish);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "qa-card",
          cardType: "qa",
          content: "Updated prompt\n---\nUpdated answer",
        }),
      );

      expect(publishEvents).toContainEqual({
        name: "CardEdited",
        payload: { deckPath, cardId: "qa-card" },
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("preserves QA metadata when replacing QA with QA", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-qa-qa-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
Original question
---
Original answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "qa-card",
          cardType: "qa",
          content: "Updated question\n---\nUpdated answer",
        }),
      );

      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items[0]!.cards.map((card) => card.id)).toEqual(["qa-card"]);
      expect(result.cardIds).toEqual(["qa-card"]);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("resets metadata when replacing QA with Cloze", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-qa-cloze-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa-to-cloze.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ qa-card 0 0 0 0-->
Original question
---
Original answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "qa-card",
          cardType: "cloze",
          content: "The capital of {{c1::France}} is {{c2::Paris}}.",
        }),
      );

      expect(result.cardIds).toHaveLength(2);
      expect(result.cardIds).not.toContain("qa-card");
      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items[0]!.cards.map((card) => card.id)).toEqual(result.cardIds);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("resets metadata when replacing Cloze with QA", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-cloze-qa-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "cloze-to-qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ c1 0 0 0 0-->
<!--@ c2 0 0 0 0-->
The {{c1::capital}} of {{c2::France}}.
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "c1",
          cardType: "qa",
          content: "Question\n---\nAnswer",
        }),
      );

      expect(result.cardIds).toHaveLength(1);
      expect(result.cardIds[0]).not.toBe("c1");
      const parsed = await Effect.runPromise(parseFile(await fs.readFile(deckPath, "utf8")));
      expect(parsed.items[0]!.cards.map((card) => card.id)).toEqual(result.cardIds);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("preserves existing cloze ids and creates new id for added cloze index", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-cloze-add-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "cloze-add.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ c1 0 0 0 0-->
<!--@ c3 0 0 0 0-->
The {{c1::first}} and {{c3::third}}.
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const result = await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "c1",
          cardType: "cloze",
          content: "The {{c1::first}} {{c2::second}} {{c3::third}}.",
        }),
      );

      expect(result.cardIds[0]).toBe("c1");
      expect(result.cardIds[2]).toBe("c3");
      expect(result.cardIds[1]).not.toBe("c1");
      expect(result.cardIds[1]).not.toBe("c3");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("adds a trailing newline during ReplaceItem to keep subsequent items parseable", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-newline-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "qa.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ first 0 0 0 0-->
Q1
---
A1

<!--@ second 0 0 0 0-->
Q2
---
A2
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "first",
          cardType: "qa",
          content: "Q1 updated\n---\nA1 updated",
        }),
      );

      const markdown = await fs.readFile(deckPath, "utf8");
      const parsed = await Effect.runPromise(parseFile(markdown));
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[1]!.cards[0]!.id).toBe("second");
      expect(markdown).toContain("A1 updated\n<!--@ second 0 0 0 0-->");
      expect(markdown).not.toContain("A1 updated<!--@ second");
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("detects duplicates and respects excludeCardIds for edit mode", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-duplicates-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "dup.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ self-card 0 0 0 0-->
Question
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const duplicate = await Effect.runPromise(
        handlers.CheckDuplicates({
          content: "Question\n---\nAnswer",
          cardType: "qa",
          rootPath,
          excludeCardIds: [],
        }),
      );
      expect(duplicate.isDuplicate).toBe(true);

      const selfExcluded = await Effect.runPromise(
        handlers.CheckDuplicates({
          content: "Question\n---\nAnswer",
          cardType: "qa",
          rootPath,
          excludeCardIds: ["self-card"],
        }),
      );
      expect(selfExcluded.isDuplicate).toBe(false);

      const incomplete = await Effect.runPromise(
        handlers.CheckDuplicates({
          content: "Question only",
          cardType: "qa",
          rootPath,
          excludeCardIds: [],
        }),
      );
      expect(incomplete.isDuplicate).toBe(false);

      await Effect.runPromise(
        handlers.AppendItem({
          deckPath,
          content: "Another question\n---\nAnother answer",
          cardType: "qa",
        }),
      );
      const eagerUpdateDuplicate = await Effect.runPromise(
        handlers.CheckDuplicates({
          content: "Another question\n---\nAnother answer",
          cardType: "qa",
          rootPath,
          excludeCardIds: [],
        }),
      );
      expect(eagerUpdateDuplicate.isDuplicate).toBe(true);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns editor_operation_error when GetItemForEdit card id is missing", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-get-item-error-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "missing.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ existing 0 0 0 0-->
Prompt
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.GetItemForEdit({ deckPath, cardId: "missing-id" }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected GetItemForEdit to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("editor_operation_error");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns editor_operation_error when ReplaceItem card id is missing", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-replace-error-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "missing-replace.md");

    try {
      await fs.writeFile(
        deckPath,
        `<!--@ existing 0 0 0 0-->
Prompt
---
Answer
`,
        "utf8",
      );

      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.ReplaceItem({
          deckPath,
          cardId: "missing-id",
          cardType: "qa",
          content: "Updated\n---\nUpdated",
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected ReplaceItem to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("editor_operation_error");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("returns editor_operation_error when CheckDuplicates root path mismatches settings", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-dup-root-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");

    try {
      const handlers = await createHandlers(settingsFilePath);
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      const exit = await Effect.runPromiseExit(
        handlers.CheckDuplicates({
          content: "Question\n---\nAnswer",
          cardType: "qa",
          rootPath: `${rootPath}-different`,
          excludeCardIds: [],
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        throw new Error("Expected CheckDuplicates to fail.");
      }
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value._tag).toBe("editor_operation_error");
      }
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });

  it("delegates OpenEditorWindow calls to the editor window manager callback", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-open-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-editor-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");

    try {
      const openEditorWindow = vi.fn();
      const handlers = await createHandlers(
        settingsFilePath,
        undefined,
        undefined,
        openEditorWindow,
      );

      await Effect.runPromise(
        handlers.OpenEditorWindow({
          mode: "edit",
          deckPath: `${rootPath}/deck.md`,
          cardId: "card-1",
        }),
      );

      expect(openEditorWindow).toHaveBeenCalledWith({
        mode: "edit",
        deckPath: `${rootPath}/deck.md`,
        cardId: "card-1",
      });
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });
});
