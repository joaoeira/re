import { fsrs, createEmptyCard, type Card, type Grade as FSRSGradeType } from "ts-fsrs";
import { Context, Data, Effect, Layer } from "effect";
import { State, numericField, type ItemMetadata } from "@re/core";

export type FSRSGrade = 0 | 1 | 2 | 3;

const gradeToRating = (grade: FSRSGrade): FSRSGradeType => (grade + 1) as FSRSGradeType;

export interface SchedulerLog {
  readonly rating: FSRSGrade;
  readonly previousState: State;
  readonly previousCard: ItemMetadata;
  readonly due: Date;
  readonly stability: number;
  readonly difficulty: number;
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly review: Date;
}

export interface ScheduleResult {
  readonly updatedCard: ItemMetadata;
  readonly schedulerLog: SchedulerLog;
}

export class ScheduleError extends Data.TaggedError("ScheduleError")<{
  readonly message: string;
  readonly cardId: string;
}> {}

/** Return the stored due date, or null when no review has been scheduled. */
export const computeDueDate = (card: ItemMetadata): Date | null => card.due;

export const isCardDue = (card: ItemMetadata, now: Date): boolean => {
  if (card.state === State.New) return false;
  const dueDate = computeDueDate(card);
  return dueDate !== null && dueDate <= now;
};

export const resolveDueDateIfDue = (card: ItemMetadata, now: Date): Date | null => {
  if (card.state === State.New) return null;
  const dueDate = computeDueDate(card);
  return dueDate !== null && dueDate <= now ? dueDate : null;
};

/**
 * Compute the scheduled interval in days for a card.
 * This is what was scheduled at last review, not the current stability.
 */
export const computeScheduledDays = (card: ItemMetadata): number => {
  if (card.state === State.Review) {
    return card.stability.value;
  }
  return 0;
};

/**
 * Compute elapsed days since last review.
 * For overdue cards, this will be > scheduled_days.
 */
export const computeElapsedDays = (card: ItemMetadata, now: Date): number => {
  if (!card.lastReview) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, (now.getTime() - card.lastReview.getTime()) / msPerDay);
};

export const itemMetadataToFSRSCard = (card: ItemMetadata, now: Date): Card => {
  if (card.state === State.New) {
    return createEmptyCard(now);
  }

  if (card.due === null || card.lastReview === null) {
    throw new RangeError("Reviewed cards require both lastReview and due timestamps");
  }

  const due = card.due;
  const elapsed_days = computeElapsedDays(card, now);
  const scheduled_days = computeScheduledDays(card);

  return {
    due,
    stability: card.stability.value,
    difficulty: card.difficulty.value,
    elapsed_days,
    scheduled_days,
    learning_steps: card.learningSteps,
    reps: 0,
    lapses: 0,
    state: card.state,
    last_review: card.lastReview,
  };
};

export const fsrsCardToItemMetadata = (
  original: ItemMetadata,
  fsrsCard: Card,
  reviewDate: Date,
): ItemMetadata => ({
  id: original.id,
  stability: numericField(fsrsCard.stability),
  difficulty: numericField(fsrsCard.difficulty),
  state: fsrsCard.state as State,
  learningSteps: fsrsCard.learning_steps,
  lastReview: reviewDate,
  due: fsrsCard.due,
});

export interface Scheduler {
  readonly isDue: (card: ItemMetadata, now: Date) => boolean;
  readonly getReviewDate: (card: ItemMetadata) => Date | null;
  readonly scheduleReview: (
    card: ItemMetadata,
    grade: FSRSGrade,
    now: Date,
  ) => Effect.Effect<ScheduleResult, ScheduleError>;
}

export const Scheduler = Context.GenericTag<Scheduler>("@re/scheduler/Scheduler");

export const SchedulerLive = Layer.succeed(Scheduler, {
  isDue: (card, now) => isCardDue(card, now),

  getReviewDate: (card) => computeDueDate(card),

  scheduleReview: (card, grade, now) =>
    Effect.try({
      try: () => {
        const f = fsrs();
        const fsrsCard = itemMetadataToFSRSCard(card, now);
        const rating = gradeToRating(grade);
        const { card: nextCard, log } = f.next(fsrsCard, now, rating);

        return {
          updatedCard: fsrsCardToItemMetadata(card, nextCard, now),
          schedulerLog: {
            rating: grade,
            previousState: card.state,
            previousCard: card,
            due: log.due,
            stability: log.stability,
            difficulty: log.difficulty,
            scheduledDays: log.scheduled_days,
            learningSteps: log.learning_steps,
            review: now,
          },
        };
      },
      catch: (error) =>
        new ScheduleError({
          message: `FSRS scheduling failed: ${String(error)}`,
          cardId: card.id,
        }),
    }),
});
