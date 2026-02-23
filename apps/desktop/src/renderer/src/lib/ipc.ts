import { appIpc } from "@shared/rpc/ipc";

export const createIpc = (bridge: Window["desktopApi"]) => appIpc.renderer(bridge);
