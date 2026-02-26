import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, Menu, type MenuItemConstructorOptions, ipcMain } from "electron";
import { Effect, Layer, Runtime } from "effect";

import {
  createNoopReviewAnalyticsRepository,
  createSqliteReviewAnalyticsRuntimeBundle,
  replayPendingCompensationIntents,
  type ReviewAnalyticsRepository,
} from "@main/analytics";
import { createEditorWindowManager, type EditorWindowManager } from "@main/editor-window";
import {
  AppRpcHandlersService,
  AppEventPublisherService,
  AnalyticsRepositoryServiceLive,
  AiClientServiceFromSecretStoreLive,
  ChunkServiceLive,
  DeckWriteCoordinatorServiceLive,
  DuplicateIndexInvalidationService,
  EditorWindowManagerService,
  ForgePromptRuntimeServiceLive,
  ForgeSessionRepositoryServiceLive,
  PdfExtractorServiceLive,
  SecretStoreServiceLive,
  SettingsRepositoryServiceLive,
  WorkspaceWatcherControlService,
  makeAppEventPublisherBridgeService,
  makeDuplicateIndexInvalidationBridgeService,
  makeEditorWindowManagerBridgeService,
  makeWorkspaceWatcherControlBridgeService,
} from "@main/di";
import { NodeServicesLive } from "@main/effect/node-services";
import {
  createDeckWriteCoordinator,
  type DeckWriteCoordinator,
} from "@main/rpc/deck-write-coordinator";
import { AppRpcHandlersServiceFromEffectLive } from "@main/rpc/handlers";
import { HandlerServicesLive } from "@main/rpc/handlers/shared";
import { makeSecretStore } from "@main/secrets";
import { makeSettingsRepository } from "@main/settings/repository";
import { createWorkspaceWatcher, type WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import {
  createSingleFlightTask,
  createUnifiedQuitPipeline,
  initializeAnalyticsRuntime,
} from "@main/lifecycle";
import {
  makeInMemoryForgeSessionRepository,
  makeSqliteForgeSessionRepository,
} from "@main/forge/services/forge-session-repository";
import { makePdfExtractor } from "@main/forge/services/pdf-extractor";
import { makeChunkService } from "@main/forge/services/chunk-service";
import { WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { appIpc } from "@shared/rpc/ipc";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPLAY_INTERVAL_MS = 60_000;

let mainWindow: BrowserWindow | null = null;
let ipcHandle: ReturnType<typeof appIpc.main> | null = null;
let watcher: WorkspaceWatcher | null = null;
let editorWindowManager: EditorWindowManager | null = null;

let analyticsRuntime:
  | ReturnType<typeof createSqliteReviewAnalyticsRuntimeBundle>["runtime"]
  | null = null;
let analyticsRepository: ReviewAnalyticsRepository = createNoopReviewAnalyticsRepository();
let deckWriteCoordinator: DeckWriteCoordinator = createDeckWriteCoordinator();

let replayTimer: ReturnType<typeof setInterval> | null = null;

const log = (...args: Array<unknown>): void => {
  console.log("[desktop/main]", ...args);
};

const setupApplicationMenu = (openNewCard: () => void): void => {
  const isDev = Boolean(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({ role: "appMenu" });
  }

  template.push({
    label: "File",
    submenu: [
      {
        label: "New Card",
        accelerator: "CommandOrControl+N",
        click: () => openNewCard(),
      },
      process.platform === "darwin" ? { role: "close" } : { role: "quit" },
    ],
  });
  template.push({ role: "editMenu" });
  if (isDev) {
    template.push({ role: "viewMenu" });
  }
  template.push({ role: "windowMenu" });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const loadMainWindow = async (window: BrowserWindow): Promise<void> => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    log("loading renderer from dev server", MAIN_WINDOW_VITE_DEV_SERVER_URL);
    await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  log("loading renderer from file", rendererPath);
  await window.loadFile(rendererPath);
};

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#f0f9ff",
    title: "re Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.on("ready-to-show", () => {
    log("window ready-to-show");
    window.show();
  });

  window.on("closed", () => {
    mainWindow = null;
    log("window closed");
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[desktop/main] renderer failed to load", {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[desktop/main] renderer process gone", details);
  });

  void loadMainWindow(window).catch((error: unknown) => {
    console.error("[desktop/main] failed to load main window", error);
  });

  return window;
};

const stopReplayTimer = (): void => {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }
};

const replayTask = createSingleFlightTask(async () => {
  if (!analyticsRepository.enabled) {
    return;
  }

  try {
    await Effect.runPromise(
      replayPendingCompensationIntents(analyticsRepository, deckWriteCoordinator).pipe(
        Effect.provide(HandlerServicesLive),
      ),
    );
  } catch (error) {
    console.error("[desktop/main] compensation replay failed", error);
  }
});

const replayPendingCompensations = async (): Promise<void> => replayTask.run();

const startReplayTimer = (): void => {
  if (!analyticsRepository.enabled || replayTimer) {
    return;
  }

  replayTimer = setInterval(() => {
    void replayPendingCompensations();
  }, REPLAY_INTERVAL_MS);
};

const disposeWatcherAndIpc = (): void => {
  if (watcher) {
    watcher.stop();
    watcher = null;
  }
  if (ipcHandle) {
    ipcHandle.dispose();
    ipcHandle = null;
  }
};

const unifiedQuitPipeline = createUnifiedQuitPipeline({
  closeEditorWindow: async () => {
    const manager = editorWindowManager;
    if (manager?.isOpen()) {
      await manager.closeAndWait();
    }
    editorWindowManager = null;
  },
  stopReplayTimer,
  disposeWatcherAndIpc,
  disposeAnalytics: async () => {
    if (analyticsRuntime) {
      await analyticsRuntime.dispose();
      analyticsRuntime = null;
    }
  },
  requestQuit: () => {
    app.quit();
  },
  onError: (error) => {
    console.error("[desktop/main] shutdown pipeline failed", error);
  },
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  log("another instance is already running, quitting");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    log("app ready");
    mainWindow = createMainWindow();
    deckWriteCoordinator = createDeckWriteCoordinator();

    const userDataPath = app.getPath("userData");
    const settingsFilePath = path.join(userDataPath, "settings.json");
    const secretsFilePath = path.join(userDataPath, "secrets.json");
    const dbPath = path.join(userDataPath, "re.db");
    const settingsRepository = Effect.runSync(
      makeSettingsRepository({ settingsFilePath }).pipe(Effect.provide(NodeServicesLive)),
    );
    const secretStore = Effect.runSync(
      makeSecretStore({
        encryptedFilePath: secretsFilePath,
      }).pipe(Effect.provide(NodeServicesLive)),
    );

    const analyticsBundle = createSqliteReviewAnalyticsRuntimeBundle({
      dbPath,
      journalPath: path.join(userDataPath, "analytics-compensation-intents.json"),
    });
    const initializedAnalytics = await initializeAnalyticsRuntime(analyticsBundle);
    analyticsRepository = initializedAnalytics.repository;
    analyticsRuntime = initializedAnalytics.runtime;
    if (initializedAnalytics.startupFailed) {
      console.error("[desktop/main] analytics startup probe failed, falling back to no-op");
    }

    const appEventPublisher = makeAppEventPublisherBridgeService();
    const workspaceWatcherControl = makeWorkspaceWatcherControlBridgeService();
    const editorWindowManagerService = makeEditorWindowManagerBridgeService();
    const duplicateIndexInvalidation = makeDuplicateIndexInvalidationBridgeService();
    const forgeSessionRepository =
      initializedAnalytics.runtime !== null
        ? makeSqliteForgeSessionRepository({ runtime: initializedAnalytics.runtime })
        : makeInMemoryForgeSessionRepository();
    const pdfExtractor = makePdfExtractor();
    const chunkService = makeChunkService();
    const aiClientLayer = AiClientServiceFromSecretStoreLive(secretStore);

    const mainServicesLive = Layer.mergeAll(
      SettingsRepositoryServiceLive(settingsRepository),
      SecretStoreServiceLive(secretStore),
      aiClientLayer,
      AnalyticsRepositoryServiceLive(analyticsRepository),
      DeckWriteCoordinatorServiceLive(deckWriteCoordinator),
      ForgeSessionRepositoryServiceLive(forgeSessionRepository),
      ForgePromptRuntimeServiceLive.pipe(Layer.provide(aiClientLayer)),
      PdfExtractorServiceLive(pdfExtractor),
      ChunkServiceLive(chunkService),
      Layer.succeed(AppEventPublisherService, appEventPublisher),
      Layer.succeed(WorkspaceWatcherControlService, workspaceWatcherControl),
      Layer.succeed(EditorWindowManagerService, editorWindowManagerService),
      Layer.succeed(DuplicateIndexInvalidationService, duplicateIndexInvalidation),
    );

    const rpc = Effect.runSync(
      Effect.gen(function* () {
        return yield* AppRpcHandlersService;
      }).pipe(Effect.provide(Layer.provide(AppRpcHandlersServiceFromEffectLive, mainServicesLive))),
    );

    editorWindowManager = createEditorWindowManager({
      preloadPath: path.join(__dirname, "preload.js"),
      publish: appEventPublisher.publish,
      log,
    });
    editorWindowManagerService.bindOpenEditorWindow((params) => editorWindowManager?.open(params));
    setupApplicationMenu(() => editorWindowManager?.open({ mode: "create" }));

    const runtime = Runtime.defaultRuntime;

    ipcHandle = appIpc.main({
      ipcMain,
      handlers: rpc.handlers,
      streamHandlers: rpc.streamHandlers,
      runtime,
      getWindows: () => BrowserWindow.getAllWindows(),
    });
    appEventPublisher.bind(ipcHandle.publish);

    watcher = createWorkspaceWatcher({
      publish: (snapshot) =>
        Effect.gen(function* () {
          duplicateIndexInvalidation.markDuplicateIndexDirty();
          yield* appEventPublisher.publish(WorkspaceSnapshotChanged, snapshot);
        }),
      runtime,
    });
    workspaceWatcherControl.bind(watcher);

    await replayPendingCompensations();
    if (!ipcHandle) {
      throw new Error("IPC handle is not initialized.");
    }
    ipcHandle.start();
    startReplayTimer();

    Effect.runPromise(settingsRepository.getSettings())
      .then((settings) => {
        if (settings.workspace.rootPath) {
          watcher?.start(settings.workspace.rootPath);
        }
      })
      .catch((error: unknown) => {
        log("failed to read settings for initial watcher start", error);
      });

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createMainWindow();
      }
    });
  });
}

app.on("before-quit", (event) => {
  unifiedQuitPipeline.handleBeforeQuit(event);
});

app.on("will-quit", () => {
  stopReplayTimer();
  disposeWatcherAndIpc();
  editorWindowManager = null;
  unifiedQuitPipeline.markShutdownComplete();
});

app.on("window-all-closed", () => {
  log("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
