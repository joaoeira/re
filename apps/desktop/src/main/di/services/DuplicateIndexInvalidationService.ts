import { Context, Effect, Layer } from "effect";

export interface DuplicateIndexInvalidationService {
  readonly markDuplicateIndexDirty: () => void;
  readonly registerListener: (listener: () => void) => void;
}

export const DuplicateIndexInvalidationService = Context.GenericTag<DuplicateIndexInvalidationService>(
  "@re/desktop/main/DuplicateIndexInvalidationService",
);

export const makeDuplicateIndexInvalidationBridgeService =
  (): DuplicateIndexInvalidationService => {
    const listeners = new Set<() => void>();

    return {
      markDuplicateIndexDirty: () => {
        for (const listener of listeners) {
          listener();
        }
      },
      registerListener: (listener) => {
        listeners.add(listener);
      },
    };
  };

export const DuplicateIndexInvalidationBridgeLive = Layer.effect(
  DuplicateIndexInvalidationService,
  Effect.sync(makeDuplicateIndexInvalidationBridgeService),
);

export const DuplicateIndexInvalidationServiceLive = () =>
  Layer.effect(
    DuplicateIndexInvalidationService,
    Effect.sync(() => {
      const listeners = new Set<() => void>();

      return {
        markDuplicateIndexDirty: () => {
          for (const listener of listeners) {
            listener();
          }
        },
        registerListener: (listener: () => void) => {
          listeners.add(listener);
        },
      } satisfies DuplicateIndexInvalidationService;
    }),
  );
