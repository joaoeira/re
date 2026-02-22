import { Effect, Layer } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { AppRpcHandlersService } from "@main/di";
import type { AppContract } from "@shared/rpc/contracts";

import { createEditorHandlers } from "./handlers/editor";
import { createReviewHandlers } from "./handlers/review";
import { ReviewServicesLive } from "./handlers/shared";
import { createWorkspaceHandlers } from "./handlers/workspace";

type Handler = (input: never) => Effect.Effect<unknown, unknown, unknown>;

type ProvidedReviewServicesHandler<THandler extends Handler> = (
  input: THandler extends (input: infer TInput) => Effect.Effect<unknown, unknown, unknown>
    ? TInput
    : never
) => Effect.Effect<
  THandler extends (input: never) => Effect.Effect<infer TSuccess, unknown, unknown>
    ? TSuccess
    : never,
  THandler extends (input: never) => Effect.Effect<unknown, infer TError, unknown>
    ? TError
    : never,
  Exclude<
    THandler extends (input: never) => Effect.Effect<unknown, unknown, infer TRuntime>
      ? TRuntime
      : never,
    Layer.Layer.Success<typeof ReviewServicesLive>
  >
>;

type ProvidedReviewServicesHandlers<THandlers extends Record<string, Handler>> = {
  [K in keyof THandlers]: ProvidedReviewServicesHandler<THandlers[K]>;
};

const provideReviewServicesToHandler = <THandler extends Handler>(
  handler: THandler,
): ProvidedReviewServicesHandler<THandler> =>
  ((input) =>
    handler(input as never).pipe(Effect.provide(ReviewServicesLive))) as ProvidedReviewServicesHandler<THandler>;

const provideReviewServices = <THandlers extends Record<string, Handler>>(
  handlers: THandlers,
): ProvidedReviewServicesHandlers<THandlers> =>
  Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      provideReviewServicesToHandler(handler),
    ]),
  ) as ProvidedReviewServicesHandlers<THandlers>;

export const makeAppRpcHandlersEffect = Effect.gen(function* () {
  const workspaceHandlers = yield* createWorkspaceHandlers();
  const reviewHandlers = yield* createReviewHandlers();
  const editorHandlers = (yield* createEditorHandlers()).handlers;

  // Migration invariant: exported RPC handlers stay at R = never.
  const handlers: Implementations<AppContract, never> = {
    ...provideReviewServices({
      ...workspaceHandlers,
      ...reviewHandlers,
      ...editorHandlers,
    }),
  };

  return { handlers };
});

export const AppRpcHandlersServiceFromEffectLive = Layer.effect(
  AppRpcHandlersService,
  makeAppRpcHandlersEffect,
);
