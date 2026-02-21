import { parseFile } from "@re/core";
import { scanDecks, snapshotWorkspace } from "@re/workspace";
import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { NodeServicesLive } from "@main/effect/node-services";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import type { AppContract } from "@shared/rpc/contracts";

const APP_NAME = "re Desktop";

type WorkspaceHandlerKeys =
  | "GetBootstrapData"
  | "ParseDeckPreview"
  | "ScanDecks"
  | "GetWorkspaceSnapshot"
  | "GetSettings"
  | "SetWorkspaceRootPath";

export const createWorkspaceHandlers = (
  settingsRepository: SettingsRepository,
  watcher: WorkspaceWatcher,
  markDuplicateIndexDirty: () => void,
): Pick<Implementations<AppContract>, WorkspaceHandlerKeys> => ({
  GetBootstrapData: () =>
    Effect.succeed({
      appName: APP_NAME,
      message: "Renderer connected to main through typed Effect RPC",
      timestamp: new Date().toISOString(),
    }),
  ParseDeckPreview: ({ markdown }) =>
    parseFile(markdown).pipe(
      Effect.map((parsed) => ({
        items: parsed.items.length,
        cards: parsed.items.reduce((total, item) => total + item.cards.length, 0),
      })),
    ),
  ScanDecks: ({ rootPath }) => scanDecks(rootPath).pipe(Effect.provide(NodeServicesLive)),
  GetWorkspaceSnapshot: ({ rootPath, options }) =>
    snapshotWorkspace(rootPath, options).pipe(Effect.provide(NodeServicesLive)),
  GetSettings: () => settingsRepository.getSettings(),
  SetWorkspaceRootPath: (input) =>
    settingsRepository.setWorkspaceRootPath(input).pipe(
      Effect.tap((settings) =>
        Effect.sync(() => {
          markDuplicateIndexDirty();
          if (settings.workspace.rootPath) {
            watcher.start(settings.workspace.rootPath);
          } else {
            watcher.stop();
          }
        }),
      ),
    ),
});
