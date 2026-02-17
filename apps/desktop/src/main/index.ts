import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain } from "electron";
import { Effect, Runtime } from "effect";

import { NodeServicesLive } from "@main/effect/node-services";
import { createAppRpcHandlers } from "@main/rpc/handlers";
import { makeSettingsRepository } from "@main/settings/repository";
import { createWorkspaceWatcher, type WorkspaceWatcher } from "@main/watcher/workspace-watcher";
import { WorkspaceSnapshotChanged } from "@shared/rpc/contracts";
import { appIpc } from "@shared/rpc/ipc";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let ipcHandle: ReturnType<typeof appIpc.main> | null = null;
let watcher: WorkspaceWatcher | null = null;

const log = (...args: Array<unknown>): void => {
  console.log("[desktop/main]", ...args);
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

app.whenReady().then(() => {
  log("app ready");
  mainWindow = createMainWindow();

  const settingsFilePath = path.join(app.getPath("userData"), "settings.json");
  const settingsRepository = Effect.runSync(
    makeSettingsRepository({ settingsFilePath }).pipe(Effect.provide(NodeServicesLive)),
  );

  const watcherProxy: WorkspaceWatcher = {
    start: (rootPath) => watcher?.start(rootPath),
    stop: () => watcher?.stop(),
  };

  const runtime = Runtime.defaultRuntime;

  ipcHandle = appIpc.main({
    ipcMain,
    handlers: createAppRpcHandlers(settingsRepository, watcherProxy),
    runtime,
    getWindow: () => mainWindow,
  });

  watcher = createWorkspaceWatcher({
    publish: (snapshot) => ipcHandle!.publish(WorkspaceSnapshotChanged, snapshot),
    runtime,
  });

  ipcHandle.start();

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
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  if (watcher) {
    watcher.stop();
    watcher = null;
  }
  if (ipcHandle) {
    ipcHandle.dispose();
    ipcHandle = null;
  }
});

app.on("window-all-closed", () => {
  log("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});
