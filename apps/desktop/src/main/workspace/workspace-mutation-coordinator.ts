import { Effect } from "effect";

export interface WorkspaceMutationCoordinator {
  readonly withWorkspaceLock: <A, E, R>(
    rootPath: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly withDeckLock: <A, E, R>(
    deckPath: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export const createWorkspaceMutationCoordinator = (): WorkspaceMutationCoordinator => {
  const semaphore = Effect.runSync(Effect.makeSemaphore(1));

  return {
    withWorkspaceLock: (_rootPath, effect) => semaphore.withPermits(1)(effect),
    withDeckLock: (_deckPath, effect) => semaphore.withPermits(1)(effect),
  };
};

export const NoOpWorkspaceMutationCoordinator: WorkspaceMutationCoordinator = {
  withWorkspaceLock: (_rootPath, effect) => effect,
  withDeckLock: (_deckPath, effect) => effect,
};
