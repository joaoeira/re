/// <reference types="vite/client" />

import type { DesktopApi } from "../../preload/api";
import type { DesktopHost } from "../../preload/api";

declare global {
  interface Window {
    desktopApi: DesktopApi;
    desktopHost: DesktopHost;
  }
}

export {};
