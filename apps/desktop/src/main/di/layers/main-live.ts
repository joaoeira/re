import { Layer } from "effect";

import type { ReviewAnalyticsRepository } from "@main/analytics";
import {
  type AppEventPublisher,
  AppEventPublisherBridgeLive,
  AppEventPublisherServiceLive,
} from "../services/AppEventPublisherService";
import { AnalyticsRepositoryServiceLive } from "../services/AnalyticsRepositoryService";
import { DeckWriteCoordinatorServiceLive } from "../services/DeckWriteCoordinatorService";
import {
  DuplicateIndexInvalidationBridgeLive,
  DuplicateIndexInvalidationServiceLive,
} from "../services/DuplicateIndexInvalidationService";
import {
  type OpenEditorWindow,
  EditorWindowManagerBridgeLive,
  EditorWindowManagerServiceLive,
} from "../services/EditorWindowManagerService";
import { SettingsRepositoryServiceLive } from "../services/SettingsRepositoryService";
import {
  WorkspaceWatcherControlBridgeLive,
  WorkspaceWatcherControlServiceLive,
} from "../services/WorkspaceWatcherControlService";
import type { DeckWriteCoordinator } from "@main/rpc/deck-write-coordinator";
import type { SettingsRepository } from "@main/settings/repository";
import type { WorkspaceWatcher } from "@main/watcher/workspace-watcher";

type MainStaticDependencies = {
  readonly settingsRepository: SettingsRepository;
  readonly analyticsRepository: ReviewAnalyticsRepository;
  readonly deckWriteCoordinator: DeckWriteCoordinator;
};

type MainDirectDependencies = MainStaticDependencies & {
  readonly publish: AppEventPublisher;
  readonly watcher: WorkspaceWatcher;
  readonly openEditorWindow: OpenEditorWindow;
};

const MainStaticLive = ({ settingsRepository, analyticsRepository, deckWriteCoordinator }: MainStaticDependencies) =>
  Layer.mergeAll(
    SettingsRepositoryServiceLive(settingsRepository),
    AnalyticsRepositoryServiceLive(analyticsRepository),
    DeckWriteCoordinatorServiceLive(deckWriteCoordinator),
  );

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
  analyticsRepository,
  deckWriteCoordinator,
  publish,
  watcher,
  openEditorWindow,
}: MainDirectDependencies) =>
  Layer.mergeAll(
    MainStaticLive({ settingsRepository, analyticsRepository, deckWriteCoordinator }),
    AppEventPublisherServiceLive(publish),
    WorkspaceWatcherControlServiceLive(watcher),
    EditorWindowManagerServiceLive(openEditorWindow),
    DuplicateIndexInvalidationServiceLive(),
  );
