import path from "node:path";

import { FileSystem } from "@effect/platform";
import {
  DeckManagerLive,
  ReviewQueueBuilderLive,
  SchedulerLive,
  ShuffledOrderingStrategy,
} from "@re/workspace";
import { Effect, Layer } from "effect";
import type { RpcHandlerContext } from "electron-effect-rpc/types";

import { NodeServicesLive } from "@main/effect/node-services";
import type { SettingsRepository } from "@main/settings/repository";
import { toErrorMessage } from "@main/utils/format";

export const DeckManagerServicesLive = DeckManagerLive.pipe(Layer.provide(NodeServicesLive));

const ReviewQueueBuilderServicesLive = ReviewQueueBuilderLive.pipe(
  Layer.provide(
    Layer.mergeAll(DeckManagerServicesLive, ShuffledOrderingStrategy, NodeServicesLive),
  ),
);

export const HandlerServicesLive = Layer.mergeAll(
  SchedulerLive,
  DeckManagerServicesLive,
  ReviewQueueBuilderServicesLive,
  NodeServicesLive,
);

export const assertWithinRoot = (deckPath: string, rootPath: string): boolean => {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedDeckPath = path.resolve(deckPath);
  const relativePath = path.relative(resolvedRootPath, resolvedDeckPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

export const getConfiguredRootPath = <E>(
  settingsRepository: SettingsRepository,
  mapSettingsError: (error: unknown) => E,
  makeMissingRootError: () => E,
): Effect.Effect<string, E> =>
  settingsRepository.getSettings().pipe(
    Effect.mapError(mapSettingsError),
    Effect.flatMap((settings) => {
      if (settings.workspace.rootPath === null) {
        return Effect.fail(makeMissingRootError());
      }

      return Effect.succeed(settings.workspace.rootPath);
    }),
  );

export const validateDeckAccess = <E>(
  settingsRepository: SettingsRepository,
  options: {
    readonly deckPath: string;
    readonly mapSettingsError: (error: unknown) => E;
    readonly makeMissingRootError: () => E;
    readonly makeOutsideRootError: (deckPath: string) => E;
  },
): Effect.Effect<string, E> =>
  getConfiguredRootPath(
    settingsRepository,
    options.mapSettingsError,
    options.makeMissingRootError,
  ).pipe(
    Effect.filterOrFail(
      (configuredRootPath) => assertWithinRoot(options.deckPath, configuredRootPath),
      () => options.makeOutsideRootError(options.deckPath),
    ),
  );

export const validateRequestedRootPath = <E>(
  settingsRepository: SettingsRepository,
  options: {
    readonly requestedRootPath: string;
    readonly mapSettingsError: (error: unknown) => E;
    readonly makeMissingRootError: () => E;
    readonly makeRootMismatchError: (configuredRootPath: string, requestedRootPath: string) => E;
  },
): Effect.Effect<string, E> =>
  getConfiguredRootPath(
    settingsRepository,
    options.mapSettingsError,
    options.makeMissingRootError,
  ).pipe(
    Effect.filterOrFail(
      (configuredRootPath) =>
        path.resolve(options.requestedRootPath) === path.resolve(configuredRootPath),
      (configuredRootPath) =>
        options.makeRootMismatchError(configuredRootPath, options.requestedRootPath),
    ),
  );

export const validateDeckAccessAs = <E>(
  settingsRepository: SettingsRepository,
  deckPath: string,
  makeError: (message: string) => E,
): Effect.Effect<string, E> =>
  validateDeckAccess(settingsRepository, {
    deckPath,
    mapSettingsError: (error) => makeError(toErrorMessage(error)),
    makeMissingRootError: () => makeError("Workspace root path is not configured."),
    makeOutsideRootError: () => makeError(`Deck path is outside workspace root: ${deckPath}`),
  });

export const validateRequestedRootPathAs = <E>(
  settingsRepository: SettingsRepository,
  requestedRootPath: string,
  makeError: (message: string) => E,
): Effect.Effect<string, E> =>
  validateRequestedRootPath(settingsRepository, {
    requestedRootPath,
    mapSettingsError: (error) => makeError(toErrorMessage(error)),
    makeMissingRootError: () => makeError("Workspace root path is not configured."),
    makeRootMismatchError: (configured, requested) =>
      makeError(`Root path mismatch. Expected ${configured}, received ${requested}.`),
  });

export const canonicalizeWorkspacePath = (
  rootPath: string,
): Effect.Effect<string, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.realPath(rootPath);
  });

type Handler = (
  input: never,
  context: RpcHandlerContext,
) => Effect.Effect<unknown, unknown, unknown>;

type ProvidedHandler<THandler extends Handler> = (
  input: Parameters<THandler>[0],
  context: RpcHandlerContext,
) => Effect.Effect<
  THandler extends (...args: never[]) => Effect.Effect<infer TSuccess, unknown, unknown>
    ? TSuccess
    : never,
  THandler extends (...args: never[]) => Effect.Effect<unknown, infer TError, unknown>
    ? TError
    : never,
  Exclude<
    THandler extends (...args: never[]) => Effect.Effect<unknown, unknown, infer TRuntime>
      ? TRuntime
      : never,
    Layer.Layer.Success<typeof HandlerServicesLive>
  >
>;

type ProvidedHandlers<THandlers extends Record<string, Handler>> = {
  [K in keyof THandlers]: ProvidedHandler<THandlers[K]>;
};

export const provideHandlerServices = <THandlers extends Record<string, Handler>>(
  handlers: THandlers,
): ProvidedHandlers<THandlers> =>
  Object.fromEntries(
    Object.entries(handlers).map(([key, handler]) => [
      key,
      (input: never, context: RpcHandlerContext) =>
        handler(input, context).pipe(Effect.provide(HandlerServicesLive)),
    ]),
  ) as ProvidedHandlers<THandlers>;
