import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Cause, Effect, Exit } from "effect";
import type { IpcMainHandle } from "electron-effect-rpc/types";
import { describe, expect, it, vi } from "vitest";

import { parseFile } from "@re/core";
import type { AppContract } from "@shared/rpc/contracts";

import { createHandlers } from "./helpers";

describe("editor handlers", () => {
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
