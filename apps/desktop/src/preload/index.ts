import { appIpc } from "@shared/rpc/ipc";

(await appIpc.preload({ global: "desktopApi" })).expose();
