import { parseFile } from "@re/core";
import { scanDecks, snapshotWorkspace } from "@re/workspace";
import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { NodeServicesLive } from "@main/effect/node-services";
import type { SettingsRepository } from "@main/settings/repository";
import type { AppContract } from "@shared/rpc/contracts";

const APP_NAME = "re Desktop";

export const createAppRpcHandlers = (
  settingsRepository: SettingsRepository,
): Implementations<AppContract> => ({
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
        cards: parsed.items.reduce(
          (total, item) => total + item.cards.length,
          0,
        ),
      })),
    ),
  ScanDecks: ({ rootPath }) =>
    scanDecks(rootPath).pipe(
      Effect.provide(NodeServicesLive),
    ),
  GetWorkspaceSnapshot: ({ rootPath, options }) =>
    snapshotWorkspace(rootPath, options).pipe(
      Effect.provide(NodeServicesLive),
    ),
  GetSettings: () => settingsRepository.getSettings(),
  SetWorkspaceRootPath: (input) =>
    settingsRepository.setWorkspaceRootPath(input),
});
