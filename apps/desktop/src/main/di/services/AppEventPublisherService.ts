import { Context, Effect, Layer } from "effect";
import type { IpcMainHandle } from "electron-effect-rpc/types";

import type { AppContract } from "@shared/rpc/contracts";

export type AppEventPublisher = IpcMainHandle<AppContract>["publish"];

export interface AppEventPublisherService {
  readonly publish: AppEventPublisher;
  readonly bind: (publish: AppEventPublisher) => void;
}

export const NoOpAppEventPublisher = ((..._args: [unknown, unknown]) =>
  Effect.void) as AppEventPublisher;

export const AppEventPublisherService = Context.GenericTag<AppEventPublisherService>(
  "@re/desktop/main/AppEventPublisherService",
);

export const makeAppEventPublisherBridgeService = (): AppEventPublisherService => {
  let currentPublish: AppEventPublisher = NoOpAppEventPublisher;

  return {
    publish: (event, payload) => currentPublish(event, payload),
    bind: (publish) => {
      currentPublish = publish;
    },
  };
};

export const AppEventPublisherBridgeLive = Layer.effect(
  AppEventPublisherService,
  Effect.sync(makeAppEventPublisherBridgeService),
);

export const AppEventPublisherServiceLive = (publish: AppEventPublisher) =>
  Layer.succeed(AppEventPublisherService, {
    publish,
    bind: () => undefined,
  });
