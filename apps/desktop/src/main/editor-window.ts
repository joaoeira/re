import path from "node:path";
import { fileURLToPath } from "node:url";

import { BrowserWindow, dialog } from "electron";
import { Effect } from "effect";
import type { IpcMainHandle } from "electron-effect-rpc/types";

import type { AppContract } from "@shared/rpc/contracts";
import { EditorNavigateRequest } from "@shared/rpc/contracts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type EditorWindowParams =
  | {
      mode: "create";
      deckPath?: string | undefined;
    }
  | {
      mode: "edit";
      deckPath: string;
      cardId: string;
    };

export interface EditorWindowManager {
  readonly open: (params: EditorWindowParams) => void;
  readonly close: () => void;
  readonly closeAndWait: () => Promise<boolean>;
  readonly destroy: () => void;
  readonly isOpen: () => boolean;
}

interface CreateEditorWindowManagerOptions {
  readonly preloadPath: string;
  readonly publish: IpcMainHandle<AppContract>["publish"];
  readonly log?: (...args: Array<unknown>) => void;
}

const buildEditorHash = (params: EditorWindowParams): string => {
  const searchParams = new URLSearchParams();
  searchParams.set("mode", params.mode);

  if (params.deckPath) {
    searchParams.set("deckPath", params.deckPath);
  }

  if (params.mode === "edit") {
    searchParams.set("cardId", params.cardId);
  }

  return `/editor?${searchParams.toString()}`;
};

const loadEditorWindow = async (
  window: BrowserWindow,
  params: EditorWindowParams,
  log: (...args: Array<unknown>) => void,
): Promise<void> => {
  const hash = buildEditorHash(params);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${hash}`;
    log("loading editor window from dev server", url);
    await window.loadURL(url);
    return;
  }

  const rendererPath = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  log("loading editor window from file", rendererPath, hash);
  await window.loadFile(rendererPath, { hash });
};

export const createEditorWindowManager = ({
  preloadPath,
  publish,
  log = () => undefined,
}: CreateEditorWindowManagerOptions): EditorWindowManager => {
  let editorWindow: BrowserWindow | null = null;

  const focusExistingWindow = (params: EditorWindowParams): boolean => {
    if (!editorWindow || editorWindow.isDestroyed()) {
      editorWindow = null;
      return false;
    }

    if (editorWindow.isMinimized()) {
      editorWindow.restore();
    }
    editorWindow.focus();

    void Effect.runPromise(publish(EditorNavigateRequest, params)).catch((error: unknown) => {
      console.error("[desktop/main] failed to publish EditorNavigateRequest", error);
    });

    return true;
  };

  const open = (params: EditorWindowParams): void => {
    if (focusExistingWindow(params)) {
      return;
    }

    const window = new BrowserWindow({
      width: 1024,
      height: 840,
      minWidth: 760,
      minHeight: 560,
      backgroundColor: "#f0f9ff",
      title: "Card Editor",
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    window.on("ready-to-show", () => {
      window.show();
    });

    window.on("closed", () => {
      editorWindow = null;
    });

    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error("[desktop/main] editor renderer failed to load", {
        errorCode,
        errorDescription,
        validatedURL,
      });
    });

    window.webContents.on("render-process-gone", (_event, details) => {
      console.error("[desktop/main] editor renderer process gone", details);
    });

    window.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(window, {
        type: "warning",
        buttons: ["Discard Changes", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        message: "You have unsaved changes.",
        detail: "Discard unsaved changes and close the editor?",
      });

      if (choice === 0) {
        event.preventDefault();
      }
    });

    editorWindow = window;
    void loadEditorWindow(window, params, log).catch((error: unknown) => {
      console.error("[desktop/main] failed to load editor window", error);
    });
  };

  const close = (): void => {
    if (!editorWindow || editorWindow.isDestroyed()) {
      editorWindow = null;
      return;
    }

    editorWindow.close();
  };

  const closeAndWait = (): Promise<boolean> => {
    if (!editorWindow || editorWindow.isDestroyed()) {
      editorWindow = null;
      return Promise.resolve(true);
    }

    const window = editorWindow;

    return new Promise((resolve) => {
      let resolved = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const finish = (closed: boolean): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        window.removeListener("close", onClose);
        window.removeListener("closed", onClosed);
        window.webContents.removeListener("will-prevent-unload", onWillPreventUnload);
        resolve(closed);
      };

      const onClose = (event: Electron.Event): void => {
        if (event.defaultPrevented) {
          finish(false);
        }
      };

      const onWillPreventUnload = (event: Electron.Event): void => {
        if (!event.defaultPrevented) {
          finish(false);
        }
      };

      const onClosed = (): void => {
        editorWindow = null;
        finish(true);
      };

      window.on("close", onClose);
      window.on("closed", onClosed);
      window.webContents.on("will-prevent-unload", onWillPreventUnload);
      timeoutId = setTimeout(() => {
        finish(window.isDestroyed());
      }, 2_000);
      window.close();
    });
  };

  const destroy = (): void => {
    if (!editorWindow || editorWindow.isDestroyed()) {
      editorWindow = null;
      return;
    }

    editorWindow.destroy();
    editorWindow = null;
  };

  const isOpen = (): boolean => Boolean(editorWindow && !editorWindow.isDestroyed());

  return { open, close, closeAndWait, destroy, isOpen };
};
