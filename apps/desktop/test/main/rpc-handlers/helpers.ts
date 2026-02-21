import { Effect } from "effect";
import type { IpcMainHandle } from "electron-effect-rpc/types";

import type { ReviewAnalyticsRepository } from "@main/analytics";
import { createNoopReviewAnalyticsRepository } from "@main/analytics";
import type { EditorWindowParams } from "@main/editor-window";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { NoOpDeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { NodeServicesLive } from "@main/effect/node-services";
import { createAppRpcHandlers } from "@main/rpc/handlers";
import { makeSettingsRepository } from "@main/settings/repository";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import type { AppContract } from "@shared/rpc/contracts";
import { DEFAULT_SETTINGS } from "@shared/settings";

export const stubSettingsRepository: SettingsRepository = {
  getSettings: () => Effect.succeed(DEFAULT_SETTINGS),
  setWorkspaceRootPath: ({ rootPath }) =>
    Effect.succeed({
      ...DEFAULT_SETTINGS,
      workspace: {
        rootPath,
      },
    }),
};

export const stubWatcher: WorkspaceWatcher = {
  start: () => {},
  stop: () => {},
};

export const noOpPublish = ((..._args: [unknown, unknown]) =>
  Effect.void) as IpcMainHandle<AppContract>["publish"];

export const defaultHandlers = createAppRpcHandlers(stubSettingsRepository, stubWatcher).handlers;

export const createHandlers = async (
  settingsFilePath: string,
  watcher?: WorkspaceWatcher,
  publish?: IpcMainHandle<AppContract>["publish"],
  openEditorWindow?: (params: EditorWindowParams) => void,
  analyticsRepository?: ReviewAnalyticsRepository,
  deckWriteCoordinator?: DeckWriteCoordinator,
) =>
  Effect.gen(function* () {
    const repository = yield* makeSettingsRepository({ settingsFilePath });
    return createAppRpcHandlers(
      repository,
      watcher ?? stubWatcher,
      publish ?? noOpPublish,
      openEditorWindow,
      analyticsRepository ?? createNoopReviewAnalyticsRepository(),
      deckWriteCoordinator ?? NoOpDeckWriteCoordinator,
    ).handlers;
  }).pipe(Effect.provide(NodeServicesLive), Effect.runPromise);
