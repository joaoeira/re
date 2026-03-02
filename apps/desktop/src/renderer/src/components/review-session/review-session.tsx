import { useCallback, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";

import { useOpenEditorWindowMutation } from "@/hooks/mutations/use-open-editor-window-mutation";
import { useReviewSession } from "@/hooks/useReviewSession";
import { CardContent } from "@/components/review-session/card-content";
import { ReviewActionBar } from "@/components/review-session/review-action-bar";
import { SessionProgress } from "@/components/review-session/session-progress";
import { SessionSummary } from "@/components/review-session/session-summary";
import { Button } from "@/components/ui/button";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import type { DesktopReviewSessionSnapshot } from "@/machines/desktopReviewSession";
import type { LightQueueItem } from "@shared/rpc/schemas/review";

type ReviewSessionProps = {
  readonly decks: "all" | string[];
};

export function ReviewSession({ decks }: ReviewSessionProps) {
  const navigate = useNavigate();
  const session = useReviewSession(decks);
  const ipc = useIpc();
  const { mutate: openEditorWindow } = useOpenEditorWindowMutation();
  const { mutate: deleteCard } = useMutation({
    mutationFn: (queueItem: LightQueueItem) =>
      runIpcEffect(
        ipc.client
          .DeleteItems({
            items: [{ deckPath: queueItem.deckPath, cardId: queueItem.cardId }],
          })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
    onError: () => undefined,
  });

  const getCurrentQueueItem = useCallback(
    (snapshot: DesktopReviewSessionSnapshot): LightQueueItem | undefined =>
      snapshot.context.queue[snapshot.context.currentIndex],
    [],
  );

  const openEditorForCurrentCard = useCallback(
    (snapshot: DesktopReviewSessionSnapshot) => {
      const queueItem = getCurrentQueueItem(snapshot);
      if (!queueItem) return;

      openEditorWindow({
        mode: "edit",
        deckPath: queueItem.deckPath,
        cardId: queueItem.cardId,
      });
    },
    [getCurrentQueueItem, openEditorWindow],
  );

  const deleteCurrentCard = useCallback(
    (snapshot: DesktopReviewSessionSnapshot) => {
      const queueItem = getCurrentQueueItem(snapshot);
      if (!queueItem) return;

      deleteCard(queueItem);
    },
    [deleteCard, getCurrentQueueItem],
  );

  useEffect(() => {
    if (session.status !== "ready") {
      return;
    }

    const { snapshot, send } = session;
    const isGrading = snapshot.matches({ presenting: "grading" });

    const onKeyDown = (event: KeyboardEvent) => {
      if (isGrading) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (snapshot.can({ type: "UNDO" })) {
          event.preventDefault();
          send({ type: "UNDO" });
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (
          (event.key === "e" || event.key === "E") &&
          (snapshot.matches({ presenting: "showPrompt" }) ||
            snapshot.matches({ presenting: "showAnswer" }))
        ) {
          event.preventDefault();
          openEditorForCurrentCard(snapshot);
          return;
        }

        if (snapshot.matches({ presenting: "showPrompt" })) {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            send({ type: "REVEAL" });
          }
          return;
        }

        if (snapshot.matches({ presenting: "showAnswer" })) {
          const gradeByKey: Record<string, 0 | 1 | 2 | 3> = {
            "1": 0,
            "2": 1,
            "3": 2,
            "4": 3,
          };
          const grade = gradeByKey[event.key];

          if (grade !== undefined) {
            event.preventDefault();
            send({ type: "GRADE", grade });
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openEditorForCurrentCard, session]);

  if (session.status === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Building review queue...</p>
      </div>
    );
  }

  if (session.status === "error") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
          <h2 className="text-xl font-semibold">Failed to start review</h2>
          <p className="text-sm text-destructive">{session.message}</p>
          <Button type="button" size="sm" onClick={() => void navigate({ to: "/" })}>
            Back to decks
          </Button>
        </div>
      </div>
    );
  }

  if (session.status === "empty") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
          <h2 className="text-xl font-semibold">Nothing to review</h2>
          <Button type="button" size="sm" onClick={() => void navigate({ to: "/" })}>
            Back to decks
          </Button>
        </div>
      </div>
    );
  }

  const { snapshot, send, notice } = session;
  const isComplete = snapshot.matches("complete");
  const isLoadingCard = snapshot.matches({ presenting: "loading" });
  const isShowingPrompt = snapshot.matches({ presenting: "showPrompt" });
  const isShowingAnswer = snapshot.matches({ presenting: "showAnswer" });
  const isGrading = snapshot.matches({ presenting: "grading" });

  return (
    <>
      <div className="relative flex flex-1 flex-col overflow-auto px-6 py-5">
        {!isComplete && (
          <SessionProgress
            current={snapshot.context.currentIndex + 1}
            total={snapshot.context.queue.length}
          />
        )}

        {notice && <p className="mb-4 text-center text-sm text-sky-700">{notice}</p>}
        {snapshot.context.error && (
          <p className="mb-4 text-center text-sm text-destructive">{snapshot.context.error}</p>
        )}

        {isComplete ? (
          <SessionSummary
            stats={snapshot.context.sessionStats}
            canUndo={snapshot.context.reviewLogStack.length > 0}
            onUndo={() => send({ type: "UNDO" })}
            onBack={() => void navigate({ to: "/" })}
          />
        ) : isLoadingCard || snapshot.context.currentCard === null ? (
          <p className="text-center text-sm text-muted-foreground">Loading card...</p>
        ) : (
          <CardContent
            card={snapshot.context.currentCard}
            deckName={snapshot.context.queue[snapshot.context.currentIndex]?.deckName ?? ""}
            isRevealed={isShowingAnswer || isGrading}
          />
        )}
      </div>

      {!isComplete && !isLoadingCard && snapshot.context.currentCard !== null && (
        <ReviewActionBar
          mode={isShowingPrompt ? "reveal" : "grade"}
          onReveal={() => send({ type: "REVEAL" })}
          onGrade={(grade) => send({ type: "GRADE", grade })}
          onEdit={() => openEditorForCurrentCard(snapshot)}
          onDelete={() => deleteCurrentCard(snapshot)}
          gradingDisabled={isGrading}
          actionsDisabled={isGrading}
        />
      )}
    </>
  );
}
