import { BrowserWindow, dialog } from "electron";
import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import {
  AiModelCatalogService,
  DuplicateIndexInvalidationService,
  SettingsRepositoryService,
  WorkspaceWatcherControlService,
} from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

import { provideHandlerServices } from "./shared";

type SettingsHandlerKeys =
  | "GetSettings"
  | "SetWorkspaceRootPath"
  | "SetDefaultModelKey"
  | "ListAiModels"
  | "SelectDirectory";

export const createSettingsHandlers = () =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepositoryService;
    const aiModelCatalog = yield* AiModelCatalogService;
    const watcherControl = yield* WorkspaceWatcherControlService;
    const duplicateIndexInvalidation = yield* DuplicateIndexInvalidationService;

    const handlers: Pick<
      Implementations<AppContract, never>,
      SettingsHandlerKeys
    > = {
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
      ListAiModels: () =>
        Effect.gen(function* () {
          const models = yield* aiModelCatalog.listModels();
          const applicationDefaultModelKey = yield* aiModelCatalog.getApplicationDefaultModelKey();
          return { models: [...models], applicationDefaultModelKey };
        }),
      SetDefaultModelKey: (input) => settingsRepository.setDefaultModelKey(input),
      SelectDirectory: () =>
        Effect.promise(async () => {
          const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
          const focusedWindow = BrowserWindow.getFocusedWindow();
          const result = focusedWindow
            ? await dialog.showOpenDialog(focusedWindow, options)
            : await dialog.showOpenDialog(options);
          return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
        }),
    };

    return provideHandlerServices(handlers);
  });
