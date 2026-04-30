import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createActor, type ActorRefFrom } from "xstate";
import { Effect } from "effect";

import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import {
  useReviewBootstrapQuery,
  type ReviewDeckSelection,
} from "@/hooks/queries/use-review-bootstrap-query";
import { queryKeys } from "@/lib/query-keys";
import { CardEdited, CardsDeleted } from "@shared/rpc/contracts";
import {
  desktopReviewSessionMachine,
  RecoverableCardLoadError,
  RecoverableUndoConflictError,
  type DesktopReviewSessionSend,
  type DesktopReviewSessionSnapshot,
} from "@/machines/desktopReviewSession";
import type { ReviewSessionOptions } from "@shared/rpc/schemas/review";

type UseReviewSessionResult =
  | { status: "loading"; send: DesktopReviewSessionSend }
  | { status: "empty"; send: DesktopReviewSessionSend }
  | { status: "error"; message: string; send: DesktopReviewSessionSend }
  | {
      status: "ready";
      snapshot: DesktopReviewSessionSnapshot;
      totalDue: number;
      totalNew: number;
      notice: string | null;
      loadCycle: number;
      send: DesktopReviewSessionSend;
    };

type ReadyReviewSessionState = {
  readonly snapshot: DesktopReviewSessionSnapshot;
  readonly totalDue: number;
  readonly totalNew: number;
  readonly notice: string | null;
  readonly loadCycle: number;
};

export function useReviewSession(
  decks: ReviewDeckSelection,
  options: ReviewSessionOptions,
): UseReviewSessionResult {
  const actorRef = useRef<ActorRefFrom<typeof desktopReviewSessionMachine> | null>(null);
  const actorTeardownRef = useRef<(() => void) | null>(null);
  const refreshReasonRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const [readyState, setReadyState] = useState<ReadyReviewSessionState | null>(null);
  const ipc = useIpc();
  const queryClient = useQueryClient();

  const send: DesktopReviewSessionSend = useCallback((event) => {
    actorRef.current?.send(event);
  }, []);

  const teardownActor = useCallback(() => {
    actorTeardownRef.current?.();
    actorTeardownRef.current = null;
  }, []);

  const {
    deckSelectionKey,
    optionsKey,
    query: bootstrapQuery,
  } = useReviewBootstrapQuery(decks, options);

  useEffect(() => {
    if (bootstrapQuery.isError || !bootstrapQuery.data || bootstrapQuery.data.items.length === 0) {
      teardownActor();
      setReadyState(null);
      return;
    }

    let isCancelled = false;

    teardownActor();

    const queue = bootstrapQuery.data;

    const actor = createActor(desktopReviewSessionMachine, {
      input: {
        queue: queue.items,
        loadCard: async (input) =>
          runIpcEffect(
            ipc.client.GetCardContent(input).pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
              Effect.catchTags({
                not_found: (e) => Effect.fail(new RecoverableCardLoadError(e.message)),
                parse_error: (e) => Effect.fail(new RecoverableCardLoadError(e.message)),
                card_index_out_of_bounds: () =>
                  Effect.fail(new RecoverableCardLoadError("Card index out of bounds")),
                read_error: (e) => Effect.fail(new Error(e.message)),
              }),
            ),
          ),
        scheduleReview: async (input) =>
          runIpcEffect(
            ipc.client.ScheduleReview(input).pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
              Effect.catchTag("review_operation_error", (reviewError) =>
                Effect.fail(new Error(reviewError.message)),
              ),
            ),
          ),
        undoReview: async (input) => {
          await runIpcEffect(
            ipc.client.UndoReview(input).pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
              Effect.catchTags({
                undo_conflict: (error) =>
                  Effect.fail(new RecoverableUndoConflictError(error.message)),
                review_operation_error: (error) => Effect.fail(new Error(error.message)),
                undo_safety_unavailable: (error) => Effect.fail(new Error(error.message)),
              }),
            ),
          );
        },
      },
    });

    actorRef.current = actor;
    actor.start();

    setReadyState({
      snapshot: actor.getSnapshot(),
      totalDue: queue.totalDue,
      totalNew: queue.totalNew,
      notice: refreshReasonRef.current,
      loadCycle: 0,
    });
    refreshReasonRef.current = null;

    const subscription = actor.subscribe((snapshotValue) => {
      if (isCancelled) return;

      if (snapshotValue.matches("refreshRequired")) {
        if (!refreshInFlightRef.current) {
          refreshInFlightRef.current = true;
          refreshReasonRef.current = "Session state was refreshed due to external changes.";
          setReadyState(null);
          void queryClient
            .invalidateQueries({
              queryKey: queryKeys.reviewBootstrap(deckSelectionKey, optionsKey),
            })
            .finally(() => {
              refreshInFlightRef.current = false;
            });
        }
        return;
      }

      setReadyState((currentState) => {
        if (!currentState) {
          return {
            snapshot: snapshotValue,
            totalDue: queue.totalDue,
            totalNew: queue.totalNew,
            notice: refreshReasonRef.current,
            loadCycle: snapshotValue.matches({ presenting: "loading" }) ? 1 : 0,
          };
        }

        const nextLoadCycle =
          snapshotValue.matches({ presenting: "loading" }) &&
          !currentState.snapshot.matches({ presenting: "loading" })
            ? currentState.loadCycle + 1
            : currentState.loadCycle;

        return {
          ...currentState,
          snapshot: snapshotValue,
          loadCycle: nextLoadCycle,
        };
      });
    });

    const unsubCardEdited = ipc.events.subscribe(CardEdited, ({ deckPath, cardId }) => {
      const snapshot = actor.getSnapshot();
      const current = snapshot.context.queue[snapshot.context.currentIndex];
      if (!current) {
        return;
      }

      if (current.deckPath === deckPath && current.cardId === cardId) {
        actor.send({ type: "CARD_EDITED" });
      }
    });

    const unsubCardsDeleted = ipc.events.subscribe(CardsDeleted, ({ items }) => {
      const snapshot = actor.getSnapshot();
      const current = snapshot.context.queue[snapshot.context.currentIndex];
      if (!current) {
        return;
      }

      const isCurrentDeleted = items.some(
        (item) => item.deckPath === current.deckPath && item.cardId === current.cardId,
      );
      if (isCurrentDeleted) {
        actor.send({ type: "CARD_DELETED" });
      }
    });

    const cleanupActor = () => {
      isCancelled = true;
      subscription.unsubscribe();
      unsubCardEdited();
      unsubCardsDeleted();
      actor.stop();
      if (actorRef.current === actor) {
        actorRef.current = null;
      }
    };

    actorTeardownRef.current = cleanupActor;

    return () => {
      if (actorTeardownRef.current === cleanupActor) {
        actorTeardownRef.current = null;
      }
      cleanupActor();
    };
  }, [
    bootstrapQuery.dataUpdatedAt,
    bootstrapQuery.data,
    bootstrapQuery.errorUpdatedAt,
    bootstrapQuery.isError,
    deckSelectionKey,
    optionsKey,
    ipc,
    queryClient,
    teardownActor,
  ]);

  if (bootstrapQuery.isPending || (bootstrapQuery.isFetching && readyState === null)) {
    return { status: "loading", send };
  }

  if (bootstrapQuery.isError) {
    return {
      status: "error",
      message: bootstrapQuery.error.message,
      send,
    };
  }

  if (bootstrapQuery.data && bootstrapQuery.data.items.length === 0) {
    return { status: "empty", send };
  }

  if (!readyState) {
    return { status: "loading", send };
  }

  return {
    status: "ready",
    snapshot: readyState.snapshot,
    totalDue: readyState.totalDue,
    totalNew: readyState.totalNew,
    notice: readyState.notice,
    loadCycle: readyState.loadCycle,
    send,
  };
}
