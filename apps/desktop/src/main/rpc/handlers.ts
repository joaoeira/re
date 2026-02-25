import { Effect, Layer } from "effect";
import type { Implementations, StreamImplementations } from "electron-effect-rpc/types";

import { AppRpcHandlersService } from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

import { createAiStreamHandlers } from "./handlers/ai";
import { createEditorHandlers } from "./handlers/editor";
import { createForgeHandlers } from "./handlers/forge";
import { createReviewHandlers } from "./handlers/review";
import { createSecretHandlers } from "./handlers/secret";
import { createWorkspaceHandlers } from "./handlers/workspace";

export const makeAppRpcHandlersEffect = Effect.gen(function* () {
  const workspaceHandlers = yield* createWorkspaceHandlers();
  const reviewHandlers = yield* createReviewHandlers();
  const editorHandlers = yield* createEditorHandlers();
  const forgeHandlers = yield* createForgeHandlers();
  const secretHandlers = yield* createSecretHandlers();
  const aiStreamHandlers = yield* createAiStreamHandlers();

  const handlers: Implementations<AppContract, never> = {
    ...workspaceHandlers,
    ...reviewHandlers,
    ...editorHandlers,
    ...forgeHandlers,
    ...secretHandlers,
  };

  const streamHandlers: StreamImplementations<AppContract, never> = {
    ...aiStreamHandlers,
  };

  return { handlers, streamHandlers };
});

export const AppRpcHandlersServiceFromEffectLive = Layer.effect(
  AppRpcHandlersService,
  makeAppRpcHandlersEffect,
);
