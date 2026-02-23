import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createNoopReviewAnalyticsRepository } from "@main/analytics";
import { MainAppBridgeLive } from "@main/di";
import { NodeServicesLive } from "@main/effect/node-services";
import { NoOpDeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { makeAppRpcHandlersEffect } from "@main/rpc/handlers";
import { makeSettingsRepository } from "@main/settings/repository";

import { stubSecretStore } from "./helpers";

describe("duplicate index invalidation wiring", () => {
  it("invalidates duplicate cache when workspace root path updates", async () => {
    const rootPath = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-duplicate-root-"));
    const settingsRoot = await fs.mkdtemp(path.join(tmpdir(), "re-desktop-duplicate-settings-"));
    const settingsFilePath = path.join(settingsRoot, "settings.json");
    const deckPath = path.join(rootPath, "dup.md");

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

      const settingsRepository = Effect.runSync(
        makeSettingsRepository({ settingsFilePath }).pipe(Effect.provide(NodeServicesLive)),
      );

      const rpc = Effect.runSync(
        makeAppRpcHandlersEffect.pipe(
          Effect.provide(
            MainAppBridgeLive({
              settingsRepository,
              secretStore: stubSecretStore,
              analyticsRepository: createNoopReviewAnalyticsRepository(),
              deckWriteCoordinator: NoOpDeckWriteCoordinator,
            }),
          ),
        ),
      );

      await Effect.runPromise(rpc.handlers.SetWorkspaceRootPath({ rootPath }));

      const duplicateInput = {
        content: "Question\n---\nAnswer",
        cardType: "qa" as const,
        rootPath,
        excludeCardIds: [],
      };

      const initialDuplicate = await Effect.runPromise(
        rpc.handlers.CheckDuplicates(duplicateInput),
      );
      expect(initialDuplicate.isDuplicate).toBe(true);

      await fs.writeFile(
        deckPath,
        `<!--@ card-a 0 0 0 0-->
Updated question
---
Updated answer
`,
        "utf8",
      );

      const staleDuplicate = await Effect.runPromise(rpc.handlers.CheckDuplicates(duplicateInput));
      expect(staleDuplicate.isDuplicate).toBe(true);

      await Effect.runPromise(rpc.handlers.SetWorkspaceRootPath({ rootPath }));

      const refreshedDuplicate = await Effect.runPromise(
        rpc.handlers.CheckDuplicates(duplicateInput),
      );
      expect(refreshedDuplicate.isDuplicate).toBe(false);
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true });
      await fs.rm(settingsRoot, { recursive: true, force: true });
    }
  });
});
