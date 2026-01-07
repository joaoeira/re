import { useReducer, useEffect, useRef, useState, useCallback } from "react";
import { Effect, Fiber, Exit } from "effect";
import { Path } from "@effect/platform";
import {
  DeckDiscovery,
  DeckLoader,
  AppLive,
  buildDeckTree,
  type DeckTreeNode,
} from "../services";

export interface UseDecksResult {
  loading: boolean;
  error: string | null;
  tree: DeckTreeNode[];
  refresh: () => void;
}

interface DecksState {
  loading: boolean;
  error: string | null;
  tree: DeckTreeNode[];
}

type DecksAction =
  | { type: "SET_LOADING"; payload: boolean }
  | {
      type: "SET_SUCCESS";
      payload: { tree: DeckTreeNode[]; error: string | null };
    }
  | { type: "SET_ERROR"; payload: string };

function decksReducer(state: DecksState, action: DecksAction): DecksState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_SUCCESS":
      return {
        ...state,
        tree: action.payload.tree,
        error: action.payload.error,
        loading: false,
      };
    case "SET_ERROR":
      return { ...state, error: action.payload, loading: false };
    default:
      return state;
  }
}

const initialState: DecksState = {
  loading: true,
  error: null,
  tree: [],
};

export function useDecks(rootPath: string): UseDecksResult {
  const [state, dispatch] = useReducer(decksReducer, initialState);
  const [refreshKey, setRefreshKey] = useState(0);
  const fiberRef = useRef<Fiber.RuntimeFiber<
    { tree: DeckTreeNode[]; error: string | null },
    never
  > | null>(null);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    dispatch({ type: "SET_LOADING", payload: true });

    const program = Effect.gen(function* () {
      const discovery = yield* DeckDiscovery;
      const loader = yield* DeckLoader;
      const path = yield* Path.Path;

      const result = yield* discovery.discoverDecks(rootPath);

      // If discovery failed, return empty tree with error
      if (result.error) {
        return { tree: [] as DeckTreeNode[], error: result.error };
      }

      const now = new Date();
      const stats = yield* loader.loadAllDecks(result.paths, now);

      return { tree: buildDeckTree(stats, rootPath, path), error: null };
    }).pipe(Effect.provide(AppLive));

    const fiber = Effect.runFork(program);
    fiberRef.current = fiber;

    Effect.runPromise(Fiber.await(fiber)).then((exit) => {
      if (cancelled) return;

      if (Exit.isSuccess(exit)) {
        dispatch({ type: "SET_SUCCESS", payload: exit.value });
      } else if (Exit.isFailure(exit)) {
        if (!Exit.isInterrupted(exit)) {
          dispatch({ type: "SET_ERROR", payload: String(exit.cause) });
        }
      }
    });

    return () => {
      cancelled = true;
      if (fiberRef.current) {
        Effect.runFork(Fiber.interrupt(fiberRef.current));
      }
    };
  }, [rootPath, refreshKey]);

  return { loading: state.loading, error: state.error, tree: state.tree, refresh };
}
