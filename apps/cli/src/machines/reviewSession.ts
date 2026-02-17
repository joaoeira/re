import { setup, assign, fromPromise } from "xstate";
import { Effect, Runtime } from "effect";
import type { QueueItem } from "../services/ReviewQueue";
import type { ReviewLogEntry, FSRSGrade, ScheduleResult } from "../services/Scheduler";
import { Scheduler } from "../services/Scheduler";
import { DeckWriter } from "../services/DeckWriter";

interface GradingResult {
  schedulerLog: ScheduleResult["schedulerLog"];
  queueIndex: number;
  deckPath: string;
  itemIndex: number;
  cardIndex: number;
}

interface SessionStats {
  reviewed: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface ReviewSessionContext {
  // Queue state
  queue: readonly QueueItem[];
  currentIndex: number;

  // Runtime for Effect execution
  runtime: Runtime.Runtime<Scheduler | DeckWriter>;

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
      runtime: Runtime.Runtime<Scheduler | DeckWriter>;
    };
    signal: AbortSignal;
  }): Promise<GradingResult> => {
    const { queueItem, queueIndex, grade, runtime } = input;

    const program = Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      const deckWriter = yield* DeckWriter;

      const scheduleResult = yield* scheduler.scheduleReview(queueItem.card, grade, new Date());

      yield* deckWriter.updateCard(
        queueItem.deckPath,
        queueItem.itemIndex,
        queueItem.cardIndex,
        scheduleResult.updatedCard,
      );

      return {
        schedulerLog: scheduleResult.schedulerLog,
        queueIndex,
        deckPath: queueItem.deckPath,
        itemIndex: queueItem.itemIndex,
        cardIndex: queueItem.cardIndex,
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
      runtime: Runtime.Runtime<Scheduler | DeckWriter>;
    };
    signal: AbortSignal;
  }): Promise<number> => {
    const { reviewLog, runtime } = input;

    const program = Effect.gen(function* () {
      const deckWriter = yield* DeckWriter;

      yield* deckWriter.updateCard(
        reviewLog.deckPath,
        reviewLog.itemIndex,
        reviewLog.cardIndex,
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
      runtime: Runtime.Runtime<Scheduler | DeckWriter>;
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

      states: {
        showPrompt: {
          entry: "hideCard",
          on: {
            REVEAL: { target: "showAnswer", actions: "clearError" },
            SKIP: [
              {
                target: "#reviewSession.complete",
                guard: "isLastCard",
                actions: "clearError",
              },
              {
                target: "showPrompt",
                actions: ["incrementIndex", "hideCard", "clearError"],
              },
            ],
            UNDO: {
              guard: "canUndo",
              target: "#reviewSession.undoing",
            },
            QUIT: { target: "#reviewSession.complete" },
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
            SKIP: [
              {
                target: "#reviewSession.complete",
                guard: "isLastCard",
                actions: "clearError",
              },
              {
                target: "showPrompt",
                actions: ["incrementIndex", "hideCard", "clearError"],
              },
            ],
            UNDO: {
              guard: "canUndo",
              target: "#reviewSession.undoing",
            },
            QUIT: { target: "#reviewSession.complete" },
          },
        },

        grading: {
          // No UNDO/QUIT/SKIP here - blocked during grading to prevent race
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
                  itemIndex: result.itemIndex,
                  cardIndex: result.cardIndex,
                };
                const stats = {
                  ...context.sessionStats,
                  reviewed: context.sessionStats.reviewed + 1,
                };
                const updatedStats = (() => {
                  switch (result.schedulerLog.rating) {
                    case 0:
                      return { ...stats, again: stats.again + 1 };
                    case 1:
                      return { ...stats, hard: stats.hard + 1 };
                    case 2:
                      return { ...stats, good: stats.good + 1 };
                    case 3:
                      return { ...stats, easy: stats.easy + 1 };
                    default:
                      return stats;
                  }
                })();
                return {
                  reviewLogStack: [...context.reviewLogStack, entry],
                  sessionStats: updatedStats,
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
            const stats = {
              ...context.sessionStats,
              reviewed: Math.max(0, context.sessionStats.reviewed - 1),
            };
            const updatedStats = (() => {
              switch (last.rating) {
                case 0:
                  return { ...stats, again: Math.max(0, stats.again - 1) };
                case 1:
                  return { ...stats, hard: Math.max(0, stats.hard - 1) };
                case 2:
                  return { ...stats, good: Math.max(0, stats.good - 1) };
                case 3:
                  return { ...stats, easy: Math.max(0, stats.easy - 1) };
                default:
                  return stats;
              }
            })();
            return {
              reviewLogStack: context.reviewLogStack.slice(0, -1),
              currentIndex: event.output,
              sessionStats: updatedStats,
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
