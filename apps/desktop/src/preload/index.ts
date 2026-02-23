import { exposeIpcBridge } from "electron-effect-rpc/preload";

exposeIpcBridge({
  global: "desktopApi",
  channelPrefix: { rpc: "rpc/", event: "event/" },
});
