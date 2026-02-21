import path from "node:path";

import { Effect } from "effect";

export interface DeckWriteCoordinator {
  readonly withDeckLock: <A, E, R>(
    deckPath: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

const normalizeDeckPath = (deckPath: string): string => path.resolve(deckPath);

export const createDeckWriteCoordinator = (): DeckWriteCoordinator => {
  const createSemaphore = () => Effect.runSync(Effect.makeSemaphore(1));
  type DeckSemaphore = ReturnType<typeof createSemaphore>;
  const semaphores = new Map<string, DeckSemaphore>();

  const getSemaphore = (deckPath: string): DeckSemaphore => {
    const key = normalizeDeckPath(deckPath);
    const existing = semaphores.get(key);
    if (existing) {
      return existing;
    }

    const created = Effect.runSync(Effect.makeSemaphore(1));
    semaphores.set(key, created);
    return created;
  };

  return {
    withDeckLock: (deckPath, effect) => getSemaphore(deckPath).withPermits(1)(effect),
  };
};

export const NoOpDeckWriteCoordinator: DeckWriteCoordinator = {
  withDeckLock: (_deckPath, effect) => effect,
};
