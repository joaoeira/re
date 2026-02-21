import path from "node:path";

import type { ParsedFile, Item } from "@re/core";
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

export const ReviewServicesLive = Layer.mergeAll(
  SchedulerLive,
  DeckManagerServicesLive,
  ReviewQueueBuilderServicesLive,
);

export const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const toStringId = (id: string): string => id;

export const assertWithinRoot = (deckPath: string, rootPath: string): boolean => {
  const resolvedRootPath = path.resolve(rootPath);
  const resolvedDeckPath = path.resolve(deckPath);
  const relativePath = path.relative(resolvedRootPath, resolvedDeckPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

export const findCardLocationById = (
  parsed: ParsedFile,
  cardId: string,
): { item: Item; card: Item["cards"][number]; itemIndex: number; cardIndex: number } | null => {
  for (let itemIndex = 0; itemIndex < parsed.items.length; itemIndex++) {
    const item = parsed.items[itemIndex]!;
    for (let cardIndex = 0; cardIndex < item.cards.length; cardIndex++) {
      const card = item.cards[cardIndex]!;
      if (card.id === cardId) {
        return { item, card, itemIndex, cardIndex };
      }
    }
  }

  return null;
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
