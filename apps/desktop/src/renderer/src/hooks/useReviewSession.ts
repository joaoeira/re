import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createActor, type ActorRefFrom } from "xstate";
import { Effect } from "effect";

import { createIpc } from "@/lib/ipc";
import {
  desktopReviewSessionMachine,
  RecoverableCardLoadError,
  type DesktopReviewSessionSend,
  type DesktopReviewSessionSnapshot,
} from "@/machines/desktopReviewSession";

type ReviewDeckSelection = "all" | string[];

const DEFAULT_SNAPSHOT_OPTIONS = {
  includeHidden: false,
  extraIgnorePatterns: [],
} as const;

const formatUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const resolveDeckPathFromRoot = (rootPath: string, relativePath: string): string => {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  const normalizedRoot =
    rootPath.endsWith("/") || rootPath.endsWith("\\") ? rootPath.slice(0, -1) : rootPath;
  const normalizedRelative = relativePath.replace(/^[/\\]+/, "").replace(/[\\/]+/g, separator);
  return `${normalizedRoot}${separator}${normalizedRelative}`;
};

type UseReviewSessionResult =
  | { status: "loading"; send: DesktopReviewSessionSend }
  | { status: "empty"; send: DesktopReviewSessionSend }
  | { status: "error"; message: string; send: DesktopReviewSessionSend }
  | {
      status: "ready";
      snapshot: DesktopReviewSessionSnapshot;
      totalDue: number;
      totalNew: number;
      send: DesktopReviewSessionSend;
    };

type ReviewSessionState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      snapshot: DesktopReviewSessionSnapshot;
      totalDue: number;
      totalNew: number;
    };

export function useReviewSession(decks: ReviewDeckSelection): UseReviewSessionResult {
  const [state, setState] = useState<ReviewSessionState>({ status: "loading" });
  const actorRef = useRef<ActorRefFrom<typeof desktopReviewSessionMachine> | null>(null);
  const send: DesktopReviewSessionSend = useCallback((event) => {
    actorRef.current?.send(event);
  }, []);

  const ipc = useMemo(() => {
    if (!window.desktopApi) return null;
    return createIpc(window.desktopApi);
  }, []);

  const deckSelectionKey = useMemo(
    () => (decks === "all" ? "all" : decks.join("\u0000")),
    [decks],
  );

  useEffect(() => {
    let isCancelled = false;
    let unsubscribe: (() => void) | null = null;

    if (!ipc) {
      setState({
        status: "error",
        message: "Desktop IPC bridge is unavailable.",
      });
      return;
    }

    if (actorRef.current) {
      actorRef.current.stop();
      actorRef.current = null;
    }

    setState({ status: "loading" });

    const load = async () => {
      try {
        const settings = await Effect.runPromise(ipc.client.GetSettings());
        const rootPath = settings.workspace.rootPath;

        if (!rootPath) {
          if (!isCancelled) {
            setState({
              status: "error",
              message: "No workspace configured. Set a workspace root path in settings.",
            });
          }
          return;
        }

        const snapshot = await Effect.runPromise(
          ipc.client.GetWorkspaceSnapshot({
            rootPath,
            options: DEFAULT_SNAPSHOT_OPTIONS,
          }),
        );

        const absoluteByRelative = new Map(
          snapshot.decks.map((deckSnapshot) => [deckSnapshot.relativePath, deckSnapshot.absolutePath]),
        );

        const deckPaths =
          decks === "all"
            ? snapshot.decks.map((deckSnapshot) => deckSnapshot.absolutePath)
            : decks.map(
                (relativePath) =>
                  absoluteByRelative.get(relativePath) ??
                  resolveDeckPathFromRoot(rootPath, relativePath),
              );

        const queue = await Effect.runPromise(
          ipc.client.BuildReviewQueue({
            deckPaths,
            rootPath,
          }),
        );

        if (isCancelled) return;

        if (queue.items.length === 0) {
          setState({ status: "empty" });
          return;
        }

        const actor = createActor(desktopReviewSessionMachine, {
          input: {
            queue: queue.items,
            loadCard: async (input) =>
              Effect.runPromise(
                ipc.client.GetCardContent(input).pipe(
                  Effect.catchTags({
                    not_found: (e) => Effect.fail(new RecoverableCardLoadError(e.message)),
                    parse_error: (e) => Effect.fail(new RecoverableCardLoadError(e.message)),
                    card_index_out_of_bounds: () =>
                      Effect.fail(new RecoverableCardLoadError("Card index out of bounds")),
                  }),
                ),
              ),
            scheduleReview: async (input) => Effect.runPromise(ipc.client.ScheduleReview(input)),
            undoReview: async (input) => {
              await Effect.runPromise(ipc.client.UndoReview(input));
            },
          },
        });

        actorRef.current = actor;
        actor.start();

        setState({
          status: "ready",
          snapshot: actor.getSnapshot(),
          totalDue: queue.totalDue,
          totalNew: queue.totalNew,
        });

        const subscription = actor.subscribe((snapshotValue) => {
          if (isCancelled) return;
          setState((currentState) => {
            if (currentState.status !== "ready") {
              return {
                status: "ready",
                snapshot: snapshotValue,
                totalDue: queue.totalDue,
                totalNew: queue.totalNew,
              };
            }

            return {
              ...currentState,
              snapshot: snapshotValue,
            };
          });
        });
        unsubscribe = () => {
          subscription.unsubscribe();
        };
      } catch (error) {
        if (isCancelled) return;
        setState({
          status: "error",
          message: formatUnknownError(error),
        });
      }
    };

    void load();

    return () => {
      isCancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
      if (actorRef.current) {
        actorRef.current.stop();
        actorRef.current = null;
      }
    };
  }, [ipc, deckSelectionKey]);

  if (state.status === "loading") {
    return { status: "loading", send };
  }

  if (state.status === "empty") {
    return { status: "empty", send };
  }

  if (state.status === "error") {
    return { status: "error", message: state.message, send };
  }

  return {
    status: "ready",
    snapshot: state.snapshot,
    totalDue: state.totalDue,
    totalNew: state.totalNew,
    send,
  };
}
