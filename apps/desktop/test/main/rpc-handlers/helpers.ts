import { Effect } from "effect";
import type { IpcMainHandle } from "electron-effect-rpc/types";

import type { ReviewAnalyticsRepository } from "@main/analytics";
import { createNoopReviewAnalyticsRepository } from "@main/analytics";
import { MainAppDirectLive, NoOpAppEventPublisher } from "@main/di";
import type { EditorWindowParams } from "@main/editor-window";
import type { ForgeSessionRepository } from "@main/forge/services/forge-session-repository";
import type { ChunkService } from "@main/forge/services/chunk-service";
import type { ForgePromptRuntime } from "@main/forge/services/prompt-runtime";
import type { PdfExtractor } from "@main/forge/services/pdf-extractor";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { NoOpDeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import { NodeServicesLive } from "@main/effect/node-services";
import { makeAppRpcHandlersEffect } from "@main/rpc/handlers";
import type { SecretStore } from "@main/secrets/secret-store";
import { makeSettingsRepository } from "@main/settings/repository";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import type { AppContract } from "@shared/rpc/contracts";
import { SecretNotFound } from "@shared/secrets";
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
  setDefaultModelKey: ({ modelKey }) =>
    Effect.succeed({
      ...DEFAULT_SETTINGS,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        defaultModelKey: modelKey,
      },
    }),
  setPromptModelOverride: ({ promptId, modelKey }) =>
    Effect.succeed({
      ...DEFAULT_SETTINGS,
      ai: {
        ...DEFAULT_SETTINGS.ai,
        promptModelOverrides:
          modelKey !== null
            ? { ...DEFAULT_SETTINGS.ai.promptModelOverrides, [promptId]: modelKey }
            : Object.fromEntries(
                Object.entries(DEFAULT_SETTINGS.ai.promptModelOverrides).filter(
                  ([k]) => k !== promptId,
                ),
              ),
      },
    }),
};

export const stubWatcher: WorkspaceWatcher = {
  start: () => {},
  stop: () => {},
};

export const stubSecretStore: SecretStore = {
  getSecret: (key) => Effect.fail(new SecretNotFound({ key })),
  setSecret: () => Effect.void,
  deleteSecret: () => Effect.void,
  hasSecret: () => Effect.succeed(false),
};

export const noOpPublish = NoOpAppEventPublisher as IpcMainHandle<AppContract>["publish"];

export const defaultHandlers = Effect.runSync(
  makeAppRpcHandlersEffect.pipe(
    Effect.provide(
      MainAppDirectLive({
        settingsRepository: stubSettingsRepository,
        secretStore: stubSecretStore,
        analyticsRepository: createNoopReviewAnalyticsRepository(),
        deckWriteCoordinator: NoOpDeckWriteCoordinator,
        publish: noOpPublish,
        watcher: stubWatcher,
        openEditorWindow: () => undefined,
      }),
    ),
    Effect.provide(NodeServicesLive),
  ),
).handlers;

export type HandlerTestOverrides = {
  readonly watcher?: WorkspaceWatcher | undefined;
  readonly publish?: IpcMainHandle<AppContract>["publish"] | undefined;
  readonly openEditorWindow?: ((params: EditorWindowParams) => void) | undefined;
  readonly analyticsRepository?: ReviewAnalyticsRepository | undefined;
  readonly deckWriteCoordinator?: DeckWriteCoordinator | undefined;
  readonly settingsRepository?: SettingsRepository | undefined;
  readonly secretStore?: SecretStore | undefined;
  readonly forgeSessionRepository?: ForgeSessionRepository | undefined;
  readonly forgePromptRuntime?: ForgePromptRuntime | undefined;
  readonly chunkService?: ChunkService | undefined;
  readonly pdfExtractor?: PdfExtractor | undefined;
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
          secretStore: overrides.secretStore ?? stubSecretStore,
          analyticsRepository:
            overrides.analyticsRepository ?? createNoopReviewAnalyticsRepository(),
          deckWriteCoordinator: overrides.deckWriteCoordinator ?? NoOpDeckWriteCoordinator,
          publish: overrides.publish ?? noOpPublish,
          watcher: overrides.watcher ?? stubWatcher,
          openEditorWindow: overrides.openEditorWindow ?? (() => undefined),
          ...(overrides.forgeSessionRepository
            ? { forgeSessionRepository: overrides.forgeSessionRepository }
            : {}),
          ...(overrides.forgePromptRuntime
            ? { forgePromptRuntime: overrides.forgePromptRuntime }
            : {}),
          ...(overrides.chunkService ? { chunkService: overrides.chunkService } : {}),
          ...(overrides.pdfExtractor ? { pdfExtractor: overrides.pdfExtractor } : {}),
        }),
      ),
    );

    return rpc.handlers;
  }).pipe(Effect.provide(NodeServicesLive), Effect.runPromise);
