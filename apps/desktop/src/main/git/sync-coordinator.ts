import { Effect } from "effect";

export interface GitSyncCoordinator {
  readonly withLock: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

/** Serialize Git commit and integration phases; deck writes use DeckManager's own locks. */
export const createGitSyncCoordinator = (): GitSyncCoordinator => {
  const semaphore = Effect.runSync(Effect.makeSemaphore(1));
  return { withLock: (effect) => semaphore.withPermits(1)(effect) };
};
