import { createStore } from "@xstate/store";

export type PersistSessionDeckPathVariables = {
  readonly requestId: number;
  readonly sessionId: number;
  readonly deckPath: string | null;
};

export type DeckTargetControllerCommand =
  | {
      readonly type: "setTargetDeckPath";
      readonly deckPath: string | null;
    }
  | ({
      readonly type: "persistSessionDeckPath";
    } & PersistSessionDeckPathVariables);

type DeckTargetControllerContext = {
  readonly pendingCreatedDeckPath: string | null;
  readonly autoResolvedScopeKeys: ReadonlySet<string>;
  readonly observedDeckPathBySessionId: ReadonlyMap<number, string | null>;
  readonly nextPersistRequestId: number;
  readonly inFlightPersistRequestsById: ReadonlyMap<
    number,
    { readonly sessionId: number; readonly deckPath: string | null }
  >;
  readonly inFlightPersistDeckPathsBySessionId: ReadonlyMap<number, ReadonlySet<string | null>>;
  readonly pendingCommands: ReadonlyArray<DeckTargetControllerCommand>;
};

type SyncFromViewEvent = {
  readonly sessionId: number | null;
  readonly scopeKey: string;
  readonly targetDeckPath: string | null;
  readonly deckPaths: ReadonlyArray<string>;
  readonly decksQuerySuccess: boolean;
  readonly decksQueryFetching: boolean;
};

const initialDeckTargetControllerContext = (): DeckTargetControllerContext => ({
  pendingCreatedDeckPath: null,
  autoResolvedScopeKeys: new Set<string>(),
  observedDeckPathBySessionId: new Map<number, string | null>(),
  nextPersistRequestId: 1,
  inFlightPersistRequestsById: new Map<number, { sessionId: number; deckPath: string | null }>(),
  inFlightPersistDeckPathsBySessionId: new Map<number, ReadonlySet<string | null>>(),
  pendingCommands: [],
});

const withSetTargetDeckPathCommand = (
  commands: ReadonlyArray<DeckTargetControllerCommand>,
  deckPath: string | null,
): ReadonlyArray<DeckTargetControllerCommand> => [
  ...commands.filter((command) => command.type !== "setTargetDeckPath"),
  { type: "setTargetDeckPath", deckPath },
];

const hasMatchingPersistCommand = (
  commands: ReadonlyArray<DeckTargetControllerCommand>,
  command: PersistSessionDeckPathVariables,
): boolean =>
  commands.some((existing) => {
    if (existing.type !== "persistSessionDeckPath") return false;
    return existing.sessionId === command.sessionId && existing.deckPath === command.deckPath;
  });

const withPersistCommand = (
  commands: ReadonlyArray<DeckTargetControllerCommand>,
  command: PersistSessionDeckPathVariables,
): ReadonlyArray<DeckTargetControllerCommand> =>
  hasMatchingPersistCommand(commands, command)
    ? commands
    : [...commands, { type: "persistSessionDeckPath", ...command }];

const removeInFlightPersistRequest = (
  context: DeckTargetControllerContext,
  requestId: number,
): {
  readonly nextInFlightPersistRequestsById: ReadonlyMap<
    number,
    { readonly sessionId: number; readonly deckPath: string | null }
  >;
  readonly nextInFlightPersistDeckPathsBySessionId: ReadonlyMap<number, ReadonlySet<string | null>>;
  readonly removedRequest: { readonly sessionId: number; readonly deckPath: string | null } | null;
} => {
  const removedRequest = context.inFlightPersistRequestsById.get(requestId) ?? null;
  if (!removedRequest) {
    return {
      nextInFlightPersistRequestsById: context.inFlightPersistRequestsById,
      nextInFlightPersistDeckPathsBySessionId: context.inFlightPersistDeckPathsBySessionId,
      removedRequest: null,
    };
  }

  const nextInFlightPersistRequestsById = new Map(context.inFlightPersistRequestsById);
  nextInFlightPersistRequestsById.delete(requestId);

  const nextInFlightPersistDeckPathsBySessionId = new Map(
    context.inFlightPersistDeckPathsBySessionId,
  );
  const sessionDeckPaths = nextInFlightPersistDeckPathsBySessionId.get(removedRequest.sessionId);
  if (sessionDeckPaths) {
    const nextSessionDeckPaths = new Set(sessionDeckPaths);
    nextSessionDeckPaths.delete(removedRequest.deckPath);
    if (nextSessionDeckPaths.size === 0) {
      nextInFlightPersistDeckPathsBySessionId.delete(removedRequest.sessionId);
    } else {
      nextInFlightPersistDeckPathsBySessionId.set(removedRequest.sessionId, nextSessionDeckPaths);
    }
  }

  return {
    nextInFlightPersistRequestsById,
    nextInFlightPersistDeckPathsBySessionId,
    removedRequest,
  };
};

export const createDeckTargetControllerStore = () =>
  createStore({
    context: initialDeckTargetControllerContext(),
    on: {
      syncFromView: (context, event: SyncFromViewEvent) => {
        let pendingCreatedDeckPath = context.pendingCreatedDeckPath;
        let autoResolvedScopeKeys = context.autoResolvedScopeKeys;
        let observedDeckPathBySessionId = context.observedDeckPathBySessionId;
        let nextPersistRequestId = context.nextPersistRequestId;
        let inFlightPersistRequestsById = context.inFlightPersistRequestsById;
        let inFlightPersistDeckPathsBySessionId = context.inFlightPersistDeckPathsBySessionId;
        let pendingCommands = context.pendingCommands;

        if (pendingCreatedDeckPath !== null && event.targetDeckPath !== pendingCreatedDeckPath) {
          pendingCreatedDeckPath = null;
        }

        if (event.sessionId !== null) {
          const sessionId = event.sessionId;
          const observedDeckPath = observedDeckPathBySessionId.get(sessionId);
          if (observedDeckPath === undefined) {
            const nextObservedDeckPathBySessionId = new Map(observedDeckPathBySessionId);
            nextObservedDeckPathBySessionId.set(sessionId, event.targetDeckPath);
            observedDeckPathBySessionId = nextObservedDeckPathBySessionId;
          } else if (observedDeckPath !== event.targetDeckPath) {
            const inFlightDeckPaths = inFlightPersistDeckPathsBySessionId.get(sessionId);
            if (!inFlightDeckPaths?.has(event.targetDeckPath)) {
              const requestId = nextPersistRequestId;
              nextPersistRequestId += 1;

              pendingCommands = withPersistCommand(pendingCommands, {
                requestId,
                sessionId,
                deckPath: event.targetDeckPath,
              });

              const nextInFlightPersistRequestsById = new Map(inFlightPersistRequestsById);
              nextInFlightPersistRequestsById.set(requestId, {
                sessionId,
                deckPath: event.targetDeckPath,
              });
              inFlightPersistRequestsById = nextInFlightPersistRequestsById;

              const nextInFlightPersistDeckPathsBySessionId = new Map(
                inFlightPersistDeckPathsBySessionId,
              );
              const nextSessionDeckPaths = new Set(
                nextInFlightPersistDeckPathsBySessionId.get(sessionId) ?? [],
              );
              nextSessionDeckPaths.add(event.targetDeckPath);
              nextInFlightPersistDeckPathsBySessionId.set(sessionId, nextSessionDeckPaths);
              inFlightPersistDeckPathsBySessionId = nextInFlightPersistDeckPathsBySessionId;
            }
          }
        }

        if (!event.decksQuerySuccess || event.decksQueryFetching) {
          return {
            ...context,
            pendingCreatedDeckPath,
            observedDeckPathBySessionId,
            nextPersistRequestId,
            inFlightPersistRequestsById,
            inFlightPersistDeckPathsBySessionId,
            pendingCommands,
          };
        }

        if (event.targetDeckPath === null) {
          if (event.deckPaths.length > 0 && !autoResolvedScopeKeys.has(event.scopeKey)) {
            const nextAutoResolvedScopeKeys = new Set(autoResolvedScopeKeys);
            nextAutoResolvedScopeKeys.add(event.scopeKey);
            autoResolvedScopeKeys = nextAutoResolvedScopeKeys;
            pendingCommands = withSetTargetDeckPathCommand(pendingCommands, event.deckPaths[0]!);
          }

          return {
            ...context,
            pendingCreatedDeckPath,
            autoResolvedScopeKeys,
            observedDeckPathBySessionId,
            nextPersistRequestId,
            inFlightPersistRequestsById,
            inFlightPersistDeckPathsBySessionId,
            pendingCommands,
          };
        }

        if (event.deckPaths.includes(event.targetDeckPath)) {
          if (!autoResolvedScopeKeys.has(event.scopeKey)) {
            const nextAutoResolvedScopeKeys = new Set(autoResolvedScopeKeys);
            nextAutoResolvedScopeKeys.add(event.scopeKey);
            autoResolvedScopeKeys = nextAutoResolvedScopeKeys;
          }

          if (pendingCreatedDeckPath === event.targetDeckPath) {
            pendingCreatedDeckPath = null;
          }

          return {
            ...context,
            pendingCreatedDeckPath,
            autoResolvedScopeKeys,
            observedDeckPathBySessionId,
            nextPersistRequestId,
            inFlightPersistRequestsById,
            inFlightPersistDeckPathsBySessionId,
            pendingCommands,
          };
        }

        if (pendingCreatedDeckPath === event.targetDeckPath) {
          return {
            ...context,
            pendingCreatedDeckPath,
            observedDeckPathBySessionId,
            nextPersistRequestId,
            inFlightPersistRequestsById,
            inFlightPersistDeckPathsBySessionId,
            pendingCommands,
          };
        }

        const nextAutoResolvedScopeKeys = new Set(autoResolvedScopeKeys);
        nextAutoResolvedScopeKeys.add(event.scopeKey);

        return {
          ...context,
          pendingCreatedDeckPath,
          autoResolvedScopeKeys: nextAutoResolvedScopeKeys,
          observedDeckPathBySessionId,
          nextPersistRequestId,
          inFlightPersistRequestsById,
          inFlightPersistDeckPathsBySessionId,
          pendingCommands: withSetTargetDeckPathCommand(pendingCommands, null),
        };
      },
      createDeckSucceeded: (context, event: { readonly deckPath: string }) => ({
        ...context,
        pendingCreatedDeckPath: event.deckPath,
        pendingCommands: withSetTargetDeckPathCommand(context.pendingCommands, event.deckPath),
      }),
      persistSucceeded: (context, event: { readonly requestId: number }) => {
        const {
          nextInFlightPersistRequestsById,
          nextInFlightPersistDeckPathsBySessionId,
          removedRequest,
        } = removeInFlightPersistRequest(context, event.requestId);
        if (!removedRequest) {
          return context;
        }

        const nextObservedDeckPathBySessionId = new Map(context.observedDeckPathBySessionId);
        nextObservedDeckPathBySessionId.set(removedRequest.sessionId, removedRequest.deckPath);

        return {
          ...context,
          observedDeckPathBySessionId: nextObservedDeckPathBySessionId,
          inFlightPersistRequestsById: nextInFlightPersistRequestsById,
          inFlightPersistDeckPathsBySessionId: nextInFlightPersistDeckPathsBySessionId,
        };
      },
      persistFailed: (context, event: { readonly requestId: number }) => {
        const {
          nextInFlightPersistRequestsById,
          nextInFlightPersistDeckPathsBySessionId,
          removedRequest,
        } = removeInFlightPersistRequest(context, event.requestId);
        if (!removedRequest) {
          return context;
        }

        return {
          ...context,
          inFlightPersistRequestsById: nextInFlightPersistRequestsById,
          inFlightPersistDeckPathsBySessionId: nextInFlightPersistDeckPathsBySessionId,
        };
      },
      commandsFlushed: (context) => ({
        ...context,
        pendingCommands: [],
      }),
      reset: () => initialDeckTargetControllerContext(),
    },
  });

export type DeckTargetControllerStore = ReturnType<typeof createDeckTargetControllerStore>;
