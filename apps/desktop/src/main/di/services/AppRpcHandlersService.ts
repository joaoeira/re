import { Context } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import type { AppContract } from "@shared/rpc/contracts";

export interface AppRpcHandlersService {
  readonly handlers: Implementations<AppContract, never>;
}

export const AppRpcHandlersService = Context.GenericTag<AppRpcHandlersService>(
  "@re/desktop/main/AppRpcHandlersService",
);
