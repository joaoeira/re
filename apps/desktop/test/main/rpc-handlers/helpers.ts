import { Effect } from "effect";
import type { IpcMainHandle } from "electron-effect-rpc/types";

import type { ReviewAnalyticsRepository } from "@main/analytics";
import { createNoopReviewAnalyticsRepository } from "@main/analytics";
import { MainAppDirectLive, NoOpAppEventPublisher } from "@main/di";
import type { EditorWindowParams } from "@main/editor-window";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { NoOpDeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { NodeServicesLive } from "@main/effect/node-services";
import { makeAppRpcHandlersEffect } from "@main/rpc/handlers";
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

export const noOpPublish = NoOpAppEventPublisher as IpcMainHandle<AppContract>["publish"];

export const defaultHandlers = Effect.runSync(
  makeAppRpcHandlersEffect.pipe(
    Effect.provide(
      MainAppDirectLive({
        settingsRepository: stubSettingsRepository,
        analyticsRepository: createNoopReviewAnalyticsRepository(),
        deckWriteCoordinator: NoOpDeckWriteCoordinator,
        publish: noOpPublish,
        watcher: stubWatcher,
        openEditorWindow: () => undefined,
      }),
    ),
  ),
).handlers;

export type HandlerTestOverrides = {
  readonly watcher?: WorkspaceWatcher | undefined;
  readonly publish?: IpcMainHandle<AppContract>["publish"] | undefined;
  readonly openEditorWindow?: ((params: EditorWindowParams) => void) | undefined;
  readonly analyticsRepository?: ReviewAnalyticsRepository | undefined;
  readonly deckWriteCoordinator?: DeckWriteCoordinator | undefined;
  readonly settingsRepository?: SettingsRepository | undefined;
};

export const createHandlersWithOverrides = async (
  settingsFilePath: string,
  overrides: HandlerTestOverrides = {},
) =>
  Effect.gen(function* () {
    const repository =
      overrides.settingsRepository ?? (yield* makeSettingsRepository({ settingsFilePath }));

    const rpc = yield* makeAppRpcHandlersEffect.pipe(
      Effect.provide(
        MainAppDirectLive({
          settingsRepository: repository,
          analyticsRepository: overrides.analyticsRepository ?? createNoopReviewAnalyticsRepository(),
          deckWriteCoordinator: overrides.deckWriteCoordinator ?? NoOpDeckWriteCoordinator,
          publish: overrides.publish ?? noOpPublish,
          watcher: overrides.watcher ?? stubWatcher,
          openEditorWindow: overrides.openEditorWindow ?? (() => undefined),
        }),
      ),
    );

    return rpc.handlers;
  }).pipe(Effect.provide(NodeServicesLive), Effect.runPromise);
