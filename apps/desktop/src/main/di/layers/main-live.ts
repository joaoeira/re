import { Layer } from "effect";

import type { ReviewAnalyticsRepository } from "@main/analytics";
import { makeChunkService, type ChunkService } from "@main/forge/services/chunk-service";
import {
  makeInMemoryForgeSessionRepository,
  type ForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";
import { makeStubPdfExtractor, type PdfExtractor } from "@main/forge/services/pdf-extractor";
import {
  type AppEventPublisher,
  AppEventPublisherBridgeLive,
  AppEventPublisherServiceLive,
} from "../services/AppEventPublisherService";
import { AnalyticsRepositoryServiceLive } from "../services/AnalyticsRepositoryService";
import { AiClientServiceFromSecretStoreLive } from "../services/AiClientService";
import { DeckWriteCoordinatorServiceLive } from "../services/DeckWriteCoordinatorService";
import { ChunkServiceLive } from "../services/ChunkService";
import { ForgeSessionRepositoryServiceLive } from "../services/ForgeSessionRepositoryService";
import {
  ForgePromptRuntimeService,
  ForgePromptRuntimeServiceLive,
  type ForgePromptRuntimeService as ForgePromptRuntime,
} from "../services/ForgePromptRuntimeService";
import {
  DuplicateIndexInvalidationBridgeLive,
  DuplicateIndexInvalidationServiceLive,
} from "../services/DuplicateIndexInvalidationService";
import {
  type OpenEditorWindow,
  EditorWindowManagerBridgeLive,
  EditorWindowManagerServiceLive,
} from "../services/EditorWindowManagerService";
import { SecretStoreServiceLive } from "../services/SecretStoreService";
import { SettingsRepositoryServiceLive } from "../services/SettingsRepositoryService";
import { PdfExtractorServiceLive } from "../services/PdfExtractorService";
import {
  WorkspaceWatcherControlBridgeLive,
  WorkspaceWatcherControlServiceLive,
} from "../services/WorkspaceWatcherControlService";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import type { SecretStore } from "@main/secrets/secret-store";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";

type MainStaticDependencies = {
  readonly settingsRepository: SettingsRepository;
  readonly secretStore: SecretStore;
  readonly analyticsRepository: ReviewAnalyticsRepository;
  readonly deckWriteCoordinator: DeckWriteCoordinator;
  readonly forgeSessionRepository?: ForgeSessionRepository;
  readonly forgePromptRuntime?: ForgePromptRuntime;
  readonly pdfExtractor?: PdfExtractor;
  readonly chunkService?: ChunkService;
};

type MainDirectDependencies = MainStaticDependencies & {
  readonly publish: AppEventPublisher;
  readonly watcher: WorkspaceWatcher;
  readonly openEditorWindow: OpenEditorWindow;
};

const MainStaticLive = ({
  settingsRepository,
  secretStore,
  analyticsRepository,
  deckWriteCoordinator,
  forgeSessionRepository,
  forgePromptRuntime,
  pdfExtractor,
  chunkService,
}: MainStaticDependencies) => {
  const aiClientLayer = AiClientServiceFromSecretStoreLive(secretStore);
  const forgePromptRuntimeLayer = forgePromptRuntime
    ? Layer.succeed(ForgePromptRuntimeService, forgePromptRuntime)
    : ForgePromptRuntimeServiceLive.pipe(Layer.provide(aiClientLayer));

  return Layer.mergeAll(
    SettingsRepositoryServiceLive(settingsRepository),
    SecretStoreServiceLive(secretStore),
    aiClientLayer,
    AnalyticsRepositoryServiceLive(analyticsRepository),
    DeckWriteCoordinatorServiceLive(deckWriteCoordinator),
    ForgeSessionRepositoryServiceLive(
      forgeSessionRepository ?? makeInMemoryForgeSessionRepository(),
    ),
    forgePromptRuntimeLayer,
    PdfExtractorServiceLive(pdfExtractor ?? makeStubPdfExtractor()),
    ChunkServiceLive(chunkService ?? makeChunkService()),
  );
};

const MainBridgeLive = Layer.mergeAll(
  AppEventPublisherBridgeLive,
  WorkspaceWatcherControlBridgeLive,
  EditorWindowManagerBridgeLive,
  DuplicateIndexInvalidationBridgeLive,
);

export const MainAppBridgeLive = (dependencies: MainStaticDependencies) =>
  Layer.mergeAll(MainStaticLive(dependencies), MainBridgeLive);

export const MainAppDirectLive = ({
  settingsRepository,
  secretStore,
  analyticsRepository,
  deckWriteCoordinator,
  publish,
  watcher,
  openEditorWindow,
  forgeSessionRepository,
  forgePromptRuntime,
  pdfExtractor,
  chunkService,
}: MainDirectDependencies) =>
  Layer.mergeAll(
    MainStaticLive({
      settingsRepository,
      secretStore,
      analyticsRepository,
      deckWriteCoordinator,
      ...(forgeSessionRepository ? { forgeSessionRepository } : {}),
      ...(forgePromptRuntime ? { forgePromptRuntime } : {}),
      ...(pdfExtractor ? { pdfExtractor } : {}),
      ...(chunkService ? { chunkService } : {}),
    }),
    AppEventPublisherServiceLive(publish),
    WorkspaceWatcherControlServiceLive(watcher),
    EditorWindowManagerServiceLive(openEditorWindow),
    DuplicateIndexInvalidationServiceLive(),
  );
