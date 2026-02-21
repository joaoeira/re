import { assign, fromPromise, setup, type SnapshotFrom } from "xstate";

import type { FSRSGrade, LightQueueItem, SerializedItemMetadata } from "@shared/rpc/schemas/review";

export class RecoverableCardLoadError extends Error {
  override readonly name = "RecoverableCardLoadError";
}

export class RecoverableUndoConflictError extends Error {
  override readonly name = "RecoverableUndoConflictError";
}

export interface CardContent {
  readonly prompt: string;
  readonly reveal: string;
  readonly cardType: "qa" | "cloze";
}

interface UndoEntry {
  readonly deckPath: string;
  readonly cardId: string;
  readonly reviewEntryId: number | null;
  readonly expectedCurrentCardFingerprint: string;
  readonly previousCardFingerprint: string;
  readonly previousCard: SerializedItemMetadata;
  readonly rating: FSRSGrade;
  readonly queueIndex: number;
}

interface SessionStats {
  readonly reviewed: number;
  readonly again: number;
  readonly hard: number;
  readonly good: number;
  readonly easy: number;
}

const incrementStats = (stats: SessionStats, rating: FSRSGrade): SessionStats => {
  const next = { ...stats, reviewed: stats.reviewed + 1 };
  switch (rating) {
    case 0:
      return { ...next, again: next.again + 1 };
    case 1:
      return { ...next, hard: next.hard + 1 };
    case 2:
      return { ...next, good: next.good + 1 };
    case 3:
      return { ...next, easy: next.easy + 1 };
  }
};

const decrementStats = (stats: SessionStats, rating: FSRSGrade): SessionStats => {
  const next = { ...stats, reviewed: Math.max(0, stats.reviewed - 1) };
  switch (rating) {
    case 0:
      return { ...next, again: Math.max(0, next.again - 1) };
    case 1:
      return { ...next, hard: Math.max(0, next.hard - 1) };
    case 2:
      return { ...next, good: Math.max(0, next.good - 1) };
    case 3:
      return { ...next, easy: Math.max(0, next.easy - 1) };
  }
};

interface DesktopReviewSessionContext {
  readonly queue: readonly LightQueueItem[];
  readonly currentIndex: number;
  readonly currentCard: CardContent | null;
  readonly reviewLogStack: readonly UndoEntry[];
  readonly pendingGrade: FSRSGrade | null;
  readonly sessionStats: SessionStats;
  readonly error: string | null;
  readonly loadCard: DesktopReviewSessionInput["loadCard"];
  readonly scheduleReview: DesktopReviewSessionInput["scheduleReview"];
  readonly undoReview: DesktopReviewSessionInput["undoReview"];
}

type DesktopReviewSessionEvent =
  | { type: "REVEAL" }
  | { type: "GRADE"; grade: FSRSGrade }
  | { type: "UNDO" }
  | { type: "QUIT" }
  | { type: "CARD_EDITED" };

type DesktopReviewSessionInput = {
  readonly queue: readonly LightQueueItem[];
  readonly loadCard: (input: {
    deckPath: string;
    cardId: string;
    cardIndex: number;
  }) => Promise<CardContent>;
  readonly scheduleReview: (input: {
    deckPath: string;
    cardId: string;
    grade: FSRSGrade;
  }) => Promise<{
    reviewEntryId: number | null;
    expectedCurrentCardFingerprint: string;
    previousCardFingerprint: string;
    previousCard: SerializedItemMetadata;
  }>;
  readonly undoReview: (input: {
    deckPath: string;
    cardId: string;
    previousCard: SerializedItemMetadata;
    reviewEntryId: number | null;
    expectedCurrentCardFingerprint: string;
    previousCardFingerprint: string;
  }) => Promise<void>;
};

type GradingResult = {
  readonly reviewEntryId: number | null;
  readonly expectedCurrentCardFingerprint: string;
  readonly previousCardFingerprint: string;
  readonly previousCard: SerializedItemMetadata;
  readonly rating: FSRSGrade;
  readonly queueIndex: number;
  readonly deckPath: string;
  readonly cardId: string;
};

const loadCardActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      queueItem: LightQueueItem;
      loadCard: DesktopReviewSessionInput["loadCard"];
    };
  }): Promise<CardContent> => {
    return input.loadCard({
      deckPath: input.queueItem.deckPath,
      cardId: input.queueItem.cardId,
      cardIndex: input.queueItem.cardIndex,
    });
  },
);

const gradingActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      queueItem: LightQueueItem;
      queueIndex: number;
      grade: FSRSGrade;
      scheduleReview: DesktopReviewSessionInput["scheduleReview"];
    };
  }): Promise<GradingResult> => {
    const scheduleResult = await input.scheduleReview({
      deckPath: input.queueItem.deckPath,
      cardId: input.queueItem.cardId,
      grade: input.grade,
    });

    return {
      reviewEntryId: scheduleResult.reviewEntryId,
      expectedCurrentCardFingerprint: scheduleResult.expectedCurrentCardFingerprint,
      previousCardFingerprint: scheduleResult.previousCardFingerprint,
      previousCard: scheduleResult.previousCard,
      rating: input.grade,
      queueIndex: input.queueIndex,
      deckPath: input.queueItem.deckPath,
      cardId: input.queueItem.cardId,
    };
  },
);

const undoActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      undoEntry: UndoEntry;
      undoReview: DesktopReviewSessionInput["undoReview"];
    };
  }): Promise<number> => {
    await input.undoReview({
      deckPath: input.undoEntry.deckPath,
      cardId: input.undoEntry.cardId,
      previousCard: input.undoEntry.previousCard,
      reviewEntryId: input.undoEntry.reviewEntryId,
      expectedCurrentCardFingerprint: input.undoEntry.expectedCurrentCardFingerprint,
      previousCardFingerprint: input.undoEntry.previousCardFingerprint,
    });

    return input.undoEntry.queueIndex;
  },
);

export const desktopReviewSessionMachine = setup({
  types: {
    context: {} as DesktopReviewSessionContext,
    events: {} as DesktopReviewSessionEvent,
    input: {} as DesktopReviewSessionInput,
  },
  actors: {
    loadCard: loadCardActor,
    grading: gradingActor,
    undo: undoActor,
  },
  guards: {
    hasMoreCards: ({ context }) => context.currentIndex < context.queue.length - 1,
    canUndo: ({ context }) => context.reviewLogStack.length > 0,
    isLastCard: ({ context }) => context.currentIndex >= context.queue.length - 1,
    hasMoreRecoverableLoadError: ({ context, event }) => {
      const loadError = (event as { error?: unknown }).error;
      return (
        context.currentIndex < context.queue.length - 1 &&
        loadError instanceof RecoverableCardLoadError
      );
    },
    isRecoverableLoadError: ({ event }) => {
      const loadError = (event as { error?: unknown }).error;
      return loadError instanceof RecoverableCardLoadError;
    },
    isRecoverableUndoConflictError: ({ event }) => {
      const undoError = (event as { error?: unknown }).error;
      return undoError instanceof RecoverableUndoConflictError;
    },
  },
  actions: {
    incrementIndex: assign({
      currentIndex: ({ context }) => context.currentIndex + 1,
    }),
  },
}).createMachine({
  id: "desktopReviewSession",
  initial: "presenting",
  context: ({ input }) => {
    if (input.queue.length === 0) {
      throw new Error("desktopReviewSessionMachine requires queue.length > 0");
    }

    return {
      queue: input.queue,
      currentIndex: 0,
      currentCard: null,
      reviewLogStack: [],
      pendingGrade: null,
      sessionStats: {
        reviewed: 0,
        again: 0,
        hard: 0,
        good: 0,
        easy: 0,
      },
      error: null,
      loadCard: input.loadCard,
      scheduleReview: input.scheduleReview,
      undoReview: input.undoReview,
    };
  },
  states: {
    presenting: {
      initial: "loading",
      on: {
        UNDO: {
          guard: "canUndo",
          target: "#desktopReviewSession.undoing",
        },
        QUIT: {
          target: "#desktopReviewSession.complete",
        },
      },
      states: {
        loading: {
          entry: assign({
            currentCard: () => null,
            error: () => null,
          }),
          invoke: {
            src: "loadCard",
            input: ({ context }) => ({
              queueItem: context.queue[context.currentIndex]!,
              loadCard: context.loadCard,
            }),
            onDone: {
              target: "showPrompt",
              actions: assign({
                currentCard: ({ event }) => event.output,
                error: () => null,
              }),
            },
            onError: [
              {
                guard: "hasMoreRecoverableLoadError",
                target: "loading",
                reenter: true,
                actions: "incrementIndex",
              },
              {
                guard: "isRecoverableLoadError",
                target: "#desktopReviewSession.complete",
              },
              {
                target: "#desktopReviewSession.complete",
                actions: assign({
                  error: ({ event }) => String(event.error),
                }),
              },
            ],
          },
        },
        showPrompt: {
          on: {
            REVEAL: { target: "showAnswer" },
            CARD_EDITED: { target: "loading" },
          },
        },
        showAnswer: {
          on: {
            GRADE: {
              target: "grading",
              actions: assign({
                pendingGrade: ({ event }) => event.grade,
                error: () => null,
              }),
            },
            CARD_EDITED: { target: "loading" },
          },
        },
        grading: {
          on: {
            UNDO: {},
            QUIT: {},
          },
          invoke: {
            src: "grading",
            input: ({ context }) => ({
              queueItem: context.queue[context.currentIndex]!,
              queueIndex: context.currentIndex,
              grade: context.pendingGrade!,
              scheduleReview: context.scheduleReview,
            }),
            onDone: {
              target: "graded",
              actions: assign(({ context, event }) => {
                const output = event.output;
                const undoEntry: UndoEntry = {
                  deckPath: output.deckPath,
                  cardId: output.cardId,
                  reviewEntryId: output.reviewEntryId,
                  expectedCurrentCardFingerprint: output.expectedCurrentCardFingerprint,
                  previousCardFingerprint: output.previousCardFingerprint,
                  previousCard: output.previousCard,
                  rating: output.rating,
                  queueIndex: output.queueIndex,
                };

                return {
                  reviewLogStack: [...context.reviewLogStack, undoEntry],
                  pendingGrade: null,
                  sessionStats: incrementStats(context.sessionStats, output.rating),
                  error: null,
                };
              }),
            },
            onError: {
              target: "showAnswer",
              actions: assign({
                pendingGrade: () => null,
                error: ({ event }) => String(event.error),
              }),
            },
          },
        },
        graded: {
          always: [
            {
              guard: "isLastCard",
              target: "#desktopReviewSession.complete",
            },
            {
              target: "loading",
              actions: "incrementIndex",
            },
          ],
          on: {
            UNDO: {},
            QUIT: {},
          },
        },
      },
    },
    undoing: {
      invoke: {
        src: "undo",
        input: ({ context }) => ({
          undoEntry: context.reviewLogStack[context.reviewLogStack.length - 1]!,
          undoReview: context.undoReview,
        }),
        onDone: {
          target: "presenting.loading",
          actions: assign(({ context, event }) => {
            const lastEntry = context.reviewLogStack[context.reviewLogStack.length - 1]!;
            return {
              reviewLogStack: context.reviewLogStack.slice(0, -1),
              currentIndex: event.output,
              pendingGrade: null,
              sessionStats: decrementStats(context.sessionStats, lastEntry.rating),
              error: null,
            };
          }),
        },
        onError: [
          {
            guard: "isRecoverableUndoConflictError",
            target: "refreshRequired",
            actions: assign({
              error: ({ event }) => String(event.error),
            }),
          },
          {
            target: "presenting.loading",
            actions: assign({
              error: ({ event }) => String(event.error),
            }),
          },
        ],
      },
    },
    refreshRequired: {},
    complete: {
      on: {
        UNDO: {
          guard: "canUndo",
          target: "undoing",
        },
      },
    },
  },
});

export type DesktopReviewSessionSnapshot = SnapshotFrom<typeof desktopReviewSessionMachine>;
export type DesktopReviewSessionSend = (event: DesktopReviewSessionEvent) => void;
