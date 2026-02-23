import path from "node:path";

import { FileSystem } from "@effect/platform";
import {
  DeckManagerLive,
  ReviewQueueBuilderLive,
  SchedulerLive,
  ShuffledOrderingStrategy,
} from "@re/workspace";
import { Effect, Layer } from "effect";

import { NodeServicesLive } from "@main/effect/node-services";
import type { SettingsRepository } from "@main/settings/repository";

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

export const canonicalizeWorkspacePath = (
  rootPath: string,
): Effect.Effect<string, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.realPath(rootPath);
  });

type Handler = (input: never) => Effect.Effect<unknown, unknown, unknown>;

type ProvidedHandler<THandler extends Handler> = (
  input: THandler extends (input: infer TInput) => Effect.Effect<unknown, unknown, unknown>
    ? TInput
    : never,
) => Effect.Effect<
  THandler extends (input: never) => Effect.Effect<infer TSuccess, unknown, unknown>
    ? TSuccess
    : never,
  THandler extends (input: never) => Effect.Effect<unknown, infer TError, unknown> ? TError : never,
  Exclude<
    THandler extends (input: never) => Effect.Effect<unknown, unknown, infer TRuntime>
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
      (input: never) => handler(input).pipe(Effect.provide(HandlerServicesLive)),
    ]),
  ) as ProvidedHandlers<THandlers>;
