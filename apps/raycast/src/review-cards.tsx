import {
  Action,
  ActionPanel,
  Detail,
  Icon,
  Keyboard,
  Toast,
  closeMainWindow,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
} from "@raycast/api";
import type { FSRSGrade } from "@re/workspace";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  gradeReviewCardForUi,
  loadReviewCardForUi,
  startReviewForUi,
  undoReviewCardForUi,
} from "./review";
import type {
  ReviewCardContent,
  ReviewCardReference,
  ReviewDeckIssue,
  ReviewSession,
  ReviewUndoToken,
} from "./review-store";
import { refreshReviewStatusMenu } from "./review-status-refresh";
import { runRaycastEffect } from "./runtime";

interface SessionStats {
  readonly reviewed: number;
  readonly again: number;
  readonly hard: number;
  readonly good: number;
  readonly easy: number;
}

interface LastReview {
  readonly undo: ReviewUndoToken;
  readonly cardIndex: number;
  readonly grade: FSRSGrade;
}

const EMPTY_STATS: SessionStats = {
  reviewed: 0,
  again: 0,
  hard: 0,
  good: 0,
  easy: 0,
};

const REVIEW_ADVANCE_SHORTCUT: Keyboard.Shortcut = { modifiers: [], key: "space" };
const GOOD_GRADE_SHORTCUT: Keyboard.Shortcut = { modifiers: [], key: "3" };
const UNDO_REVIEW_SHORTCUT: Keyboard.Shortcut = { modifiers: ["cmd"], key: "z" };

const incrementStats = (stats: SessionStats, grade: FSRSGrade): SessionStats => {
  switch (grade) {
    case 0:
      return { ...stats, reviewed: stats.reviewed + 1, again: stats.again + 1 };
    case 1:
      return { ...stats, reviewed: stats.reviewed + 1, hard: stats.hard + 1 };
    case 2:
      return { ...stats, reviewed: stats.reviewed + 1, good: stats.good + 1 };
    case 3:
      return { ...stats, reviewed: stats.reviewed + 1, easy: stats.easy + 1 };
  }
};

const decrementStats = (stats: SessionStats, grade: FSRSGrade): SessionStats => {
  switch (grade) {
    case 0:
      return { ...stats, reviewed: stats.reviewed - 1, again: stats.again - 1 };
    case 1:
      return { ...stats, reviewed: stats.reviewed - 1, hard: stats.hard - 1 };
    case 2:
      return { ...stats, reviewed: stats.reviewed - 1, good: stats.good - 1 };
    case 3:
      return { ...stats, reviewed: stats.reviewed - 1, easy: stats.easy - 1 };
  }
};

const issueSummary = (issues: readonly ReviewDeckIssue[]): string =>
  issues.length === 1 ? "1 deck could not be loaded" : `${issues.length} decks could not be loaded`;

const renderIssues = (issues: readonly ReviewDeckIssue[]): string =>
  issues
    .map((issue) => `- **${issue.relativePath}** — ${issue.message.replaceAll("\n", " ")}`)
    .join("\n");

const renderCardMarkdown = (card: ReviewCardContent, isRevealed: boolean): string => {
  if (card.cardType === "cloze") {
    return isRevealed ? card.reveal : card.prompt;
  }

  return isRevealed ? `${card.prompt}\n\n---\n\n${card.reveal}` : card.prompt;
};

const reviewNavigationTitle = (
  reference: ReviewCardReference,
  currentIndex: number,
  totalCards: number,
  isRevealed: boolean,
  canUndo: boolean,
): string => {
  const deck = reference.relativePath.replace(/\.md$/, "");
  const context = `${deck} · ${currentIndex + 1}/${totalCards}`;
  const undoHint = canUndo ? " · ⌘Z Undo" : "";
  return isRevealed
    ? `${context} · 1 Again · 2 Hard · Space / 3 Good · 4 Easy${undoHint}`
    : `${context} · Space Reveal${undoHint}`;
};

const renderComplete = (stats: SessionStats, issues: readonly ReviewDeckIssue[]): string => {
  const warning =
    issues.length === 0
      ? ""
      : `\n\n> ${issueSummary(issues)} and were not included in this session.\n\n${renderIssues(issues)}`;

  return `# Review complete

Reviewed **${stats.reviewed}** cards.

| Again | Hard | Good | Easy |
| ---: | ---: | ---: | ---: |
| ${stats.again} | ${stats.hard} | ${stats.good} | ${stats.easy} |${warning}`;
};

const renderEmpty = (issues: readonly ReviewDeckIssue[]): string => {
  if (issues.length === 0) {
    return "# Nothing to review\n\nThere are no new or due cards in the workspace.";
  }

  return `# Nothing to review

There are no new or due cards in the readable decks.

> ${issueSummary(issues)} and may contain cards that could not be checked.

${renderIssues(issues)}`;
};

export default function ReviewCardsCommand() {
  const preferences = getPreferenceValues<Preferences>();
  const [session, setSession] = useState<ReviewSession>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [card, setCard] = useState<ReviewCardContent>();
  const [cardLoadError, setCardLoadError] = useState<string>();
  const [startError, setStartError] = useState<string>();
  const [isStarting, setIsStarting] = useState(true);
  const [isLoadingCard, setIsLoadingCard] = useState(false);
  const [cardReloadCycle, setCardReloadCycle] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const [isMutatingReview, setIsMutatingReview] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [lastReview, setLastReview] = useState<LastReview>();
  const startGeneration = useRef(0);
  const cardGeneration = useRef(0);
  const reviewMutationInFlight = useRef(false);

  const startReview = useCallback(async () => {
    const generation = ++startGeneration.current;
    cardGeneration.current += 1;
    setIsStarting(true);
    setStartError(undefined);
    setSession(undefined);
    setCurrentIndex(0);
    setCard(undefined);
    setCardLoadError(undefined);
    setCardReloadCycle(0);
    setIsRevealed(false);
    setIsComplete(false);
    setStats(EMPTY_STATS);
    setLastReview(undefined);

    const result = await runRaycastEffect(startReviewForUi(preferences.workspacePath));
    if (generation !== startGeneration.current) return;

    if (result._tag === "ReviewStartError") {
      setStartError(result.message);
      setIsStarting(false);
      return;
    }

    setSession(result.session);
    setIsComplete(result.session.cards.length === 0);
    setIsStarting(false);
  }, [preferences.workspacePath]);

  useEffect(() => {
    void startReview();
    return () => {
      startGeneration.current += 1;
      cardGeneration.current += 1;
    };
  }, [startReview]);

  useEffect(() => {
    if (session === undefined || isComplete) return;
    const reference = session.cards[currentIndex];
    if (reference === undefined) {
      setIsComplete(true);
      return;
    }

    const generation = ++cardGeneration.current;
    setCard(undefined);
    setCardLoadError(undefined);
    setIsRevealed(false);
    setIsLoadingCard(true);

    void runRaycastEffect(loadReviewCardForUi(session.rootPath, reference)).then((result) => {
      if (generation !== cardGeneration.current) return;

      if (result._tag === "ReviewCardLoadError") {
        setCardLoadError(result.message);
      } else {
        setCard(result.card);
      }
      setIsLoadingCard(false);
    });

    return () => {
      cardGeneration.current += 1;
    };
  }, [cardReloadCycle, currentIndex, isComplete, session]);

  const advance = useCallback(() => {
    if (session === undefined || currentIndex >= session.cards.length - 1) {
      setCard(undefined);
      setCardLoadError(undefined);
      setIsComplete(true);
      return;
    }
    setCurrentIndex((index) => index + 1);
  }, [currentIndex, session]);

  const gradeCard = useCallback(
    async (grade: FSRSGrade) => {
      if (
        reviewMutationInFlight.current ||
        session === undefined ||
        card === undefined ||
        !isRevealed
      ) {
        return;
      }
      const reference = session.cards[currentIndex];
      if (reference === undefined) return;

      reviewMutationInFlight.current = true;
      setIsMutatingReview(true);
      try {
        const result = await runRaycastEffect(gradeReviewCardForUi(reference, grade));
        if (result._tag === "ReviewGradeError") {
          await showToast({
            style: Toast.Style.Failure,
            title: "Could not save the review",
            message: result.message,
          });
          return;
        }

        setStats((current) => incrementStats(current, grade));
        setLastReview({ undo: result.undo, cardIndex: currentIndex, grade });
        void refreshReviewStatusMenu();
        advance();
      } finally {
        reviewMutationInFlight.current = false;
        setIsMutatingReview(false);
      }
    },
    [advance, card, currentIndex, isRevealed, session],
  );

  const undoLastReview = useCallback(async () => {
    if (reviewMutationInFlight.current || lastReview === undefined) return;

    reviewMutationInFlight.current = true;
    setIsMutatingReview(true);
    try {
      const result = await runRaycastEffect(undoReviewCardForUi(lastReview.undo));
      if (result._tag === "ReviewUndoError") {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not undo the review",
          message: result.message,
        });
        return;
      }

      cardGeneration.current += 1;
      setCard(undefined);
      setCardLoadError(undefined);
      setCurrentIndex(lastReview.cardIndex);
      setIsRevealed(false);
      setIsComplete(false);
      setStats((current) => decrementStats(current, lastReview.grade));
      setLastReview(undefined);
      void refreshReviewStatusMenu();
    } finally {
      reviewMutationInFlight.current = false;
      setIsMutatingReview(false);
    }
  }, [lastReview]);

  const currentReference = session?.cards[currentIndex];
  const undoAction =
    lastReview === undefined ? null : (
      <Action
        title="Undo Last Review"
        icon="↩️"
        shortcut={UNDO_REVIEW_SHORTCUT}
        onAction={() => void undoLastReview()}
      />
    );

  if (isStarting) {
    return <Detail isLoading markdown="" navigationTitle="Review Cards" />;
  }

  if (startError !== undefined) {
    return (
      <Detail
        navigationTitle="Review Cards"
        markdown={`# Could not start review\n\n${startError}`}
        actions={
          <ActionPanel>
            <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => void startReview()} />
            <Action
              title="Open Extension Preferences"
              icon={Icon.Gear}
              onAction={openExtensionPreferences}
            />
          </ActionPanel>
        }
      />
    );
  }

  if (session === undefined) {
    return <Detail markdown="# Could not start review" navigationTitle="Review Cards" />;
  }

  if (isComplete) {
    const isEmpty = stats.reviewed === 0 && session.cards.length === 0;
    return (
      <Detail
        isLoading={isMutatingReview}
        navigationTitle={lastReview === undefined ? "Review Cards" : "Review Cards · ⌘Z Undo"}
        markdown={isEmpty ? renderEmpty(session.issues) : renderComplete(stats, session.issues)}
        actions={
          <ActionPanel>
            {isEmpty ? (
              <Action
                title="Refresh Queue"
                icon={Icon.ArrowClockwise}
                onAction={() => void startReview()}
              />
            ) : (
              <Action title="Close Review" icon="✅" onAction={() => void closeMainWindow()} />
            )}
            {!isEmpty && (
              <Action
                title="Start New Session"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={() => void startReview()}
              />
            )}
            {undoAction}
            <Action
              title="Open Extension Preferences"
              icon={Icon.Gear}
              onAction={openExtensionPreferences}
            />
          </ActionPanel>
        }
      />
    );
  }

  if (isLoadingCard || currentReference === undefined) {
    return (
      <Detail
        isLoading
        markdown=""
        navigationTitle={
          currentReference === undefined
            ? `Review Cards · ${currentIndex + 1}/${session.cards.length}`
            : reviewNavigationTitle(
                currentReference,
                currentIndex,
                session.cards.length,
                false,
                lastReview !== undefined,
              )
        }
        actions={undoAction === null ? undefined : <ActionPanel>{undoAction}</ActionPanel>}
      />
    );
  }

  if (cardLoadError !== undefined) {
    return (
      <Detail
        navigationTitle={reviewNavigationTitle(
          currentReference,
          currentIndex,
          session.cards.length,
          false,
          lastReview !== undefined,
        )}
        markdown={`# Could not load this card\n\n${cardLoadError}\n\n_${currentReference.relativePath}_`}
        actions={
          <ActionPanel>
            <Action title="Skip Card" icon="⏭️" onAction={advance} />
            <Action
              title="Retry Card"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={() => setCardReloadCycle((cycle) => cycle + 1)}
            />
            {undoAction}
            <Action.Open title="Open Deck" target={currentReference.deckPath} />
          </ActionPanel>
        }
      />
    );
  }

  if (card === undefined) {
    return (
      <Detail
        isLoading
        markdown=""
        navigationTitle={lastReview === undefined ? "Review Cards" : "Review Cards · ⌘Z Undo"}
        actions={undoAction === null ? undefined : <ActionPanel>{undoAction}</ActionPanel>}
      />
    );
  }

  const markdown = renderCardMarkdown(card, isRevealed);

  return (
    <Detail
      isLoading={isMutatingReview}
      navigationTitle={reviewNavigationTitle(
        currentReference,
        currentIndex,
        session.cards.length,
        isRevealed,
        lastReview !== undefined,
      )}
      markdown={markdown}
      actions={
        <ActionPanel>
          {isRevealed ? (
            <>
              <Action
                title="Good"
                icon="3️⃣"
                shortcut={REVIEW_ADVANCE_SHORTCUT}
                onAction={() => void gradeCard(2)}
              />
              <Action
                title="Again"
                icon="1️⃣"
                shortcut={{ modifiers: [], key: "1" }}
                onAction={() => void gradeCard(0)}
              />
              <Action
                title="Hard"
                icon="2️⃣"
                shortcut={{ modifiers: [], key: "2" }}
                onAction={() => void gradeCard(1)}
              />
              <Action
                title="Good"
                icon="3️⃣"
                shortcut={GOOD_GRADE_SHORTCUT}
                onAction={() => void gradeCard(2)}
              />
              <Action
                title="Easy"
                icon="4️⃣"
                shortcut={{ modifiers: [], key: "4" }}
                onAction={() => void gradeCard(3)}
              />
            </>
          ) : (
            <Action
              title="Reveal Answer"
              icon={Icon.Eye}
              shortcut={REVIEW_ADVANCE_SHORTCUT}
              onAction={() => setIsRevealed(true)}
            />
          )}
          {undoAction}
          <Action.Open
            title="Open Deck"
            target={currentReference.deckPath}
            shortcut={Keyboard.Shortcut.Common.Open}
          />
        </ActionPanel>
      }
    />
  );
}
