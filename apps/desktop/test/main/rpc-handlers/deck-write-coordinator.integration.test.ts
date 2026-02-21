import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";

import { createHandlers } from "./helpers";

describe("shared deck write coordinator wiring", () => {
  it("uses the same coordinator for editor and review mutators", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-lock-shared-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-lock-shared-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "shared.md");

    const lockCalls: string[] = [];
    const coordinator: DeckWriteCoordinator = {
      withDeckLock: (lockedDeckPath, effect) =>
        Effect.sync(() => {
          lockCalls.push(lockedDeckPath);
        }).pipe(Effect.zipRight(effect)),
    };

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

      const handlers = await createHandlers(
        settingsFilePath,
        undefined,
        undefined,
        undefined,
        undefined,
        coordinator,
      );
      await Effect.runPromise(handlers.SetWorkspaceRootPath({ rootPath }));

      await Effect.runPromise(
        handlers.AppendItem({
          deckPath,
          content: "Second question\n---\nSecond answer",
          cardType: "qa",
        }),
      );

      await Effect.runPromise(
        handlers.ScheduleReview({
          deckPath,
          cardId: "qa-card",
          grade: 2,
        }),
      );

      await Effect.runPromise(
        handlers.ReplaceItem({
          deckPath,
          cardId: "qa-card",
          content: "Updated\n---\nUpdated",
          cardType: "qa",
        }),
      );

      expect(lockCalls.filter((entry) => entry === deckPath).length).toBeGreaterThanOrEqual(3);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });
});
