import { Effect, Layer } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { AppRpcHandlersService } from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

import { createEditorHandlers } from "./handlers/editor";
import { createReviewHandlers } from "./handlers/review";
import { createWorkspaceHandlers } from "./handlers/workspace";

export const makeAppRpcHandlersEffect = Effect.gen(function* () {
  const workspaceHandlers = yield* createWorkspaceHandlers();
  const reviewHandlers = yield* createReviewHandlers();
  const editorHandlers = yield* createEditorHandlers();

  const handlers: Implementations<AppContract, never> = {
    ...workspaceHandlers,
    ...reviewHandlers,
    ...editorHandlers,
  };

  return { handlers };
});

export const AppRpcHandlersServiceFromEffectLive = Layer.effect(
  AppRpcHandlersService,
  makeAppRpcHandlersEffect,
);
