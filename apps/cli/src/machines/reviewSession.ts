import { setup, assign, fromPromise } from "xstate";
import { Effect, Runtime } from "effect";
import type { QueueItem } from "@re/workspace";
import type { FSRSGrade, ScheduleResult } from "@re/workspace";
import { DeckManager, Scheduler } from "@re/workspace";
import type { ReviewLogEntry } from "../services/ReviewLogEntry";

interface GradingResult {
  schedulerLog: ScheduleResult["schedulerLog"];
  queueIndex: number;
  deckPath: string;
  cardId: string;
}

interface SessionStats {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

function incrementStats(stats: SessionStats, rating: number): SessionStats {
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
    default:
      return next;
  }
}

function decrementStats(stats: SessionStats, rating: number): SessionStats {
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
    default:
      return next;
  }
}

interface ReviewSessionContext {
  // Queue state
  queue: readonly QueueItem[];
  currentIndex: number;

  // Runtime for Effect execution
  runtime: Runtime.Runtime<Scheduler | DeckManager>;

  // Undo stack - stores review logs for each completed review
  reviewLogStack: readonly ReviewLogEntry[];

  // Current card presentation state
  isRevealed: boolean;

  // Pending grade (set on GRADE event, used in grading invoke)
  pendingGrade: FSRSGrade | null;

  // Session stats
  sessionStats: SessionStats;

  // Error state
  error: string | null;
}

type ReviewSessionEvent =
  | { type: "START" }
  | { type: "REVEAL" }
  | { type: "GRADE"; grade: FSRSGrade }
  | { type: "SKIP" }
  | { type: "UNDO" }
  | { type: "QUIT" };

const gradingActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    input: {
      queueItem: QueueItem;
      queueIndex: number;
      grade: FSRSGrade;
      runtime: Runtime.Runtime<Scheduler | DeckManager>;
    };
    signal: AbortSignal;
  }): Promise<GradingResult> => {
    const { queueItem, queueIndex, grade, runtime } = input;

    const program = Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      const deckManager = yield* DeckManager;

      const scheduleResult = yield* scheduler.scheduleReview(queueItem.card, grade, new Date());

      yield* deckManager.updateCardMetadata(
        queueItem.deckPath,
        queueItem.card.id,
        scheduleResult.updatedCard,
      );

      return {
        schedulerLog: scheduleResult.schedulerLog,
        queueIndex,
        deckPath: queueItem.deckPath,
        cardId: queueItem.card.id,
      };
    });

    return Runtime.runPromise(runtime)(program, { signal });
  },
);

const undoActor = fromPromise(
  async ({
    input,
    signal,
  }: {
    input: {
      reviewLog: ReviewLogEntry;
      runtime: Runtime.Runtime<Scheduler | DeckManager>;
    };
    signal: AbortSignal;
  }): Promise<number> => {
    const { reviewLog, runtime } = input;

    const program = Effect.gen(function* () {
      const deckManager = yield* DeckManager;

      yield* deckManager.updateCardMetadata(
        reviewLog.deckPath,
        reviewLog.cardId,
        reviewLog.previousCard,
      );

      return reviewLog.queueIndex;
    });

    return Runtime.runPromise(runtime)(program, { signal });
  },
);

export const reviewSessionMachine = setup({
  types: {
    context: {} as ReviewSessionContext,
    events: {} as ReviewSessionEvent,
    input: {} as {
      queue: readonly QueueItem[];
      runtime: Runtime.Runtime<Scheduler | DeckManager>;
    },
  },

  actors: {
    grading: gradingActor,
    undo: undoActor,
  },

  guards: {
    hasMoreCards: ({ context }) => context.currentIndex < context.queue.length - 1,
    canUndo: ({ context }) => context.reviewLogStack.length > 0,
    isLastCard: ({ context }) => context.currentIndex >= context.queue.length - 1,
  },

  actions: {
    revealCard: assign({ isRevealed: true }),
    hideCard: assign({ isRevealed: false }),
    incrementIndex: assign({
      currentIndex: ({ context }) => context.currentIndex + 1,
    }),
    popReviewLog: assign({
      reviewLogStack: ({ context }) => context.reviewLogStack.slice(0, -1),
    }),
    clearError: assign({ error: null }),
  },
}).createMachine({
  id: "reviewSession",

  context: ({ input }) => ({
    queue: input.queue,
    runtime: input.runtime,
    currentIndex: 0,
    reviewLogStack: [],
    isRevealed: false,
    sessionStats: { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 },
    error: null,
    pendingGrade: null,
  }),

  initial: "idle",

  states: {
    idle: {
      on: {
        START: { target: "presenting" },
      },
    },

    presenting: {
      initial: "showPrompt",
      on: {
        SKIP: [
          {
            target: "#reviewSession.complete",
            guard: "isLastCard",
            actions: "clearError",
          },
          {
            target: ".showPrompt",
            actions: ["incrementIndex", "hideCard", "clearError"],
          },
        ],
        UNDO: {
          guard: "canUndo",
          target: "#reviewSession.undoing",
        },
        QUIT: { target: "#reviewSession.complete" },
      },

      states: {
        showPrompt: {
          entry: "hideCard",
          on: {
            REVEAL: { target: "showAnswer", actions: "clearError" },
          },
        },

        showAnswer: {
          entry: "revealCard",
          on: {
            GRADE: {
              target: "grading",
              actions: assign({
                pendingGrade: ({ event }) => event.grade,
                error: null,
              }),
            },
          },
        },

        grading: {
          // No UNDO/QUIT/SKIP here - blocked during grading to prevent race
          on: {
            SKIP: undefined,
            UNDO: undefined,
            QUIT: undefined,
          },
          invoke: {
            src: "grading",
            input: ({ context }) => ({
              queueItem: context.queue[context.currentIndex]!,
              queueIndex: context.currentIndex,
              grade: context.pendingGrade!,
              runtime: context.runtime,
            }),
            onDone: {
              target: "graded",
              actions: assign(({ context, event }) => {
                const result = event.output;
                const entry: ReviewLogEntry = {
                  ...result.schedulerLog,
                  queueIndex: result.queueIndex,
                  deckPath: result.deckPath,
                  cardId: result.cardId,
                };
                return {
                  reviewLogStack: [...context.reviewLogStack, entry],
                  sessionStats: incrementStats(context.sessionStats, result.schedulerLog.rating),
                  error: null,
                };
              }),
            },
            onError: {
              target: "showAnswer",
              actions: assign({ error: "Failed to save review" }),
            },
          },
        },

        graded: {
          always: [
            {
              target: "#reviewSession.complete",
              guard: "isLastCard",
            },
            { target: "showPrompt", actions: ["incrementIndex", "hideCard"] },
          ],
          on: {
            SKIP: undefined,
            UNDO: undefined,
            QUIT: undefined,
          },
        },
      },
    },

    undoing: {
      invoke: {
        src: "undo",
        input: ({ context }) => ({
          reviewLog: context.reviewLogStack[context.reviewLogStack.length - 1]!,
          runtime: context.runtime,
        }),
        onDone: {
          target: "presenting.showPrompt",
          actions: assign(({ context, event }) => {
            const last = context.reviewLogStack[context.reviewLogStack.length - 1]!;
            return {
              reviewLogStack: context.reviewLogStack.slice(0, -1),
              currentIndex: event.output,
              sessionStats: decrementStats(context.sessionStats, last.rating),
              error: null,
            };
          }),
        },
        onError: {
          target: "presenting.showPrompt",
          actions: assign({ error: "Failed to undo" }),
        },
      },
    },

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
