import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { useReviewSession } from "@/hooks/useReviewSession";
import { CardContent } from "@/components/review-session/card-content";
import { ReviewActionBar } from "@/components/review-session/review-action-bar";
import { SessionSummary } from "@/components/review-session/session-summary";
import { Button } from "@/components/ui/button";

type ReviewSessionProps = {
  readonly decks: "all" | string[];
};

export function ReviewSession({ decks }: ReviewSessionProps) {
  const navigate = useNavigate();
  const session = useReviewSession(decks);

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
  }, [session]);

  if (session.status === "loading") {
    return (
      <section className="flex min-h-screen items-center justify-center px-6 py-10">
        <p className="text-sm text-muted-foreground">Building review queue...</p>
      </section>
    );
  }

  if (session.status === "error") {
    return (
      <section className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
          <h2 className="text-xl font-semibold">Failed to start review</h2>
          <p className="text-sm text-destructive">{session.message}</p>
          <Button type="button" size="sm" onClick={() => void navigate({ to: "/" })}>
            Back to decks
          </Button>
        </div>
      </section>
    );
  }

  if (session.status === "empty") {
    return (
      <section className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-4 text-center">
          <h2 className="text-xl font-semibold">Nothing to review</h2>
          <Button type="button" size="sm" onClick={() => void navigate({ to: "/" })}>
            Back to decks
          </Button>
        </div>
      </section>
    );
  }

  const { snapshot, send } = session;
  const isComplete = snapshot.matches("complete");
  const isLoadingCard = snapshot.matches({ presenting: "loading" });
  const isShowingPrompt = snapshot.matches({ presenting: "showPrompt" });
  const isShowingAnswer = snapshot.matches({ presenting: "showAnswer" });
  const isGrading = snapshot.matches({ presenting: "grading" });

  const queueLength = snapshot.context.queue.length;
  const currentIndex = snapshot.context.currentIndex;
  const currentItem = snapshot.context.queue[Math.min(currentIndex, queueLength - 1)] ?? null;
  const progress = `${isComplete ? queueLength : currentIndex + 1}/${queueLength}`;
  const headerDeckName = isComplete ? "Session complete" : (currentItem?.deckName ?? "");

  return (
    <section className="flex min-h-screen flex-col px-6 py-5 pb-24">
      <header className="flex items-center gap-3">
        <Button type="button" variant="ghost" size="icon" onClick={() => void navigate({ to: "/" })}>
          <ArrowLeft size={16} />
          <span className="sr-only">Back to decks</span>
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground">{progress}</span>
        <span className="truncate text-sm text-foreground">{headerDeckName}</span>
      </header>

      <div className="flex flex-1 flex-col justify-start py-8">
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
            isRevealed={isShowingAnswer || isGrading}
          />
        )}
      </div>

      {!isComplete && !isLoadingCard && snapshot.context.currentCard !== null && (
        <ReviewActionBar
          mode={isShowingPrompt ? "reveal" : "grade"}
          onReveal={() => send({ type: "REVEAL" })}
          onGrade={(grade) => send({ type: "GRADE", grade })}
          gradingDisabled={isGrading}
        />
      )}
    </section>
  );
}
