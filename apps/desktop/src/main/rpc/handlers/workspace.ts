import { parseFile } from "@re/core";
import { scanDecks, snapshotWorkspace } from "@re/workspace";
import { Effect } from "effect";
import type { FileSystem, Path } from "@effect/platform";
import type { Implementations } from "electron-effect-rpc/types";

import {
  DuplicateIndexInvalidationService,
  SettingsRepositoryService,
  WorkspaceWatcherControlService,
} from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

const APP_NAME = "re Desktop";

type WorkspaceHandlerKeys =
  | "GetBootstrapData"
  | "ParseDeckPreview"
  | "ScanDecks"
  | "GetWorkspaceSnapshot"
  | "GetSettings"
  | "SetWorkspaceRootPath";

type WorkspaceHandlerRuntime = FileSystem.FileSystem | Path.Path;

export const createWorkspaceHandlers = () =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepositoryService;
    const watcherControl = yield* WorkspaceWatcherControlService;
    const duplicateIndexInvalidation = yield* DuplicateIndexInvalidationService;

    const handlers: Pick<Implementations<AppContract, WorkspaceHandlerRuntime>, WorkspaceHandlerKeys> = {
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
      ScanDecks: ({ rootPath }) => scanDecks(rootPath),
      GetWorkspaceSnapshot: ({ rootPath, options }) => snapshotWorkspace(rootPath, options),
      GetSettings: () => settingsRepository.getSettings(),
      SetWorkspaceRootPath: (input) =>
        settingsRepository.setWorkspaceRootPath(input).pipe(
          Effect.tap((settings) =>
            Effect.sync(() => {
              duplicateIndexInvalidation.markDuplicateIndexDirty();
              if (settings.workspace.rootPath) {
                watcherControl.start(settings.workspace.rootPath);
              } else {
                watcherControl.stop();
              }
            }),
          ),
        ),
    };

    return handlers;
  });
