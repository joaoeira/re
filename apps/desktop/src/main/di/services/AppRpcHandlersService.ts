import { Context } from "effect";
import type { Implementations, StreamImplementations } from "electron-effect-rpc/types";

import type { AppContract } from "@shared/rpc/contracts";

export interface AppRpcHandlersService {
  readonly handlers: Implementations<AppContract, never>;
  readonly streamHandlers: StreamImplementations<AppContract, never>;
}

export const AppRpcHandlersService = Context.GenericTag<AppRpcHandlersService>(
  "@re/desktop/main/AppRpcHandlersService",
);
