import type { IpcBridgeGlobal } from "electron-effect-rpc";

export type DesktopApi = IpcBridgeGlobal<"desktopApi">["desktopApi"];

export interface DesktopHost {
  readonly getPathForFile: (file: File) => string;
}
