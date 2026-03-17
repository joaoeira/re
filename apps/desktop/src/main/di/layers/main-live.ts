import { Layer } from "effect";

import type { ReviewAnalyticsRepository } from "@main/analytics";
import { makeAiModelCatalog, type AiModelCatalog } from "@main/ai/model-catalog";
import { getBundledAiModelCatalogDocument } from "@main/ai/model-catalog-repository";
import { makeChunkService, type ChunkService } from "@main/forge/services/chunk-service";
import {
  makeInMemoryForgeSessionRepository,
  type ForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";
import { makeStubPdfExtractor, type PdfExtractor } from "@main/forge/services/pdf-extractor";
import { AiModelCatalogService } from "../services/AiModelCatalogService";
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
import { ForgeSourceResolverServiceLive } from "../services/ForgeSourceResolverService";
import { TopicGroundingTextResolverServiceLive } from "../services/TopicGroundingTextResolverService";
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
import { PromptModelResolverServiceLive } from "../services/PromptModelResolverService";
import {
  WorkspaceWatcherControlBridgeLive,
  WorkspaceWatcherControlServiceLive,
} from "../services/WorkspaceWatcherControlService";
import { NodeServicesLive } from "@main/effect/node-services";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import type { SecretStore } from "@main/secrets/secret-store";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";

type MainStaticDependencies = {
  readonly settingsRepository: SettingsRepository;
  readonly secretStore: SecretStore;
  readonly analyticsRepository: ReviewAnalyticsRepository;
  readonly deckWriteCoordinator: DeckWriteCoordinator;
  readonly aiModelCatalog?: AiModelCatalog;
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
  aiModelCatalog,
  forgeSessionRepository,
  forgePromptRuntime,
  pdfExtractor,
  chunkService,
}: MainStaticDependencies) => {
  const repository = forgeSessionRepository ?? makeInMemoryForgeSessionRepository();
  const settingsRepositoryLayer = SettingsRepositoryServiceLive(settingsRepository);
  const aiClientLayer = AiClientServiceFromSecretStoreLive(secretStore);
  const aiModelCatalogLayer = aiModelCatalog
    ? Layer.succeed(AiModelCatalogService, aiModelCatalog)
    : Layer.succeed(AiModelCatalogService, makeAiModelCatalog(getBundledAiModelCatalogDocument()));
  const promptModelResolverLayer = PromptModelResolverServiceLive.pipe(
    Layer.provideMerge(settingsRepositoryLayer),
    Layer.provideMerge(aiModelCatalogLayer),
  );
  const forgePromptRuntimeLayer = forgePromptRuntime
    ? Layer.succeed(ForgePromptRuntimeService, forgePromptRuntime)
    : ForgePromptRuntimeServiceLive.pipe(
        Layer.provideMerge(aiClientLayer),
        Layer.provideMerge(aiModelCatalogLayer),
        Layer.provideMerge(promptModelResolverLayer),
      );
  const forgeSessionRepositoryLayer = ForgeSessionRepositoryServiceLive(repository);
  const pdfExtractorLayer = PdfExtractorServiceLive(pdfExtractor ?? makeStubPdfExtractor());
  const forgeSourceResolverLayer = ForgeSourceResolverServiceLive.pipe(
    Layer.provide(pdfExtractorLayer),
  );
  const topicGroundingTextResolverLayer = TopicGroundingTextResolverServiceLive.pipe(
    Layer.provide(forgeSessionRepositoryLayer),
  );

  return Layer.mergeAll(
    NodeServicesLive,
    settingsRepositoryLayer,
    SecretStoreServiceLive(secretStore),
    aiModelCatalogLayer,
    aiClientLayer,
    AnalyticsRepositoryServiceLive(analyticsRepository),
    DeckWriteCoordinatorServiceLive(deckWriteCoordinator),
    forgeSessionRepositoryLayer,
    promptModelResolverLayer,
    forgePromptRuntimeLayer,
    pdfExtractorLayer,
    forgeSourceResolverLayer,
    topicGroundingTextResolverLayer,
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
  aiModelCatalog,
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
      ...(aiModelCatalog ? { aiModelCatalog } : {}),
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
