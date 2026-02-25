import { contextBridge, webUtils } from "electron";
import { exposeIpcBridge } from "electron-effect-rpc/preload";

exposeIpcBridge({
  global: "desktopApi",
  channelPrefix: { rpc: "rpc/", event: "event/" },
});

contextBridge.exposeInMainWorld("desktopHost", {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
});
