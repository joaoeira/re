import {
  fsrs,
  checkParameters,
  ConvertStepUnitToMinutes,
  createEmptyCard,
  type Card,
  type FSRS,
  type Grade as FSRSGradeType,
  type StepUnit,
} from "ts-fsrs";
import { Context, Data, Effect, Layer, Schema } from "effect";
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
  if (card.state === State.New || card.due === null || card.lastReview === null) return 0;
  return Math.max(0, Math.floor((card.due.getTime() - card.lastReview.getTime()) / 86_400_000));
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

/** FSRS settings. Omitted fields use the installed engine's defaults. */
export interface FSRSOptions {
  /** Target recall probability, greater than 0 and at most 1. */
  readonly request_retention?: number;
  /** Positive safe integer days capping the next due date, including learning steps. */
  readonly maximum_interval?: number;
  /** Positive whole-number delays in minutes, hours, or days; [] lets FSRS choose the steps. */
  readonly learning_steps?: readonly StepUnit[];
  readonly relearning_steps?: readonly StepUnit[];
  readonly enable_fuzz?: boolean;
  /** Disabling short-term scheduling also disables learning and relearning steps. */
  readonly enable_short_term?: boolean;
  /** Finite model weights in a length supported by ts-fsrs; normalized by the engine. */
  readonly w?: readonly number[];
}

export class SchedulerConfigError extends Data.TaggedError("SchedulerConfigError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const toSchedulerConfigError = (cause: unknown): SchedulerConfigError =>
  new SchedulerConfigError({ message: `Invalid FSRS configuration: ${String(cause)}`, cause });

const StepSchema = Schema.TemplateLiteral(Schema.Number, Schema.Literal("m", "h", "d")).pipe(
  // Safe integers have at most 16 digits. Bound the input before calling the
  // engine's converter, which throws if parsing the number overflows.
  Schema.pattern(/^[1-9]\d{0,15}[mhd]$/),
  Schema.filter((step) => Number.isSafeInteger(ConvertStepUnitToMinutes(step)), {
    message: () => "Step duration must fit in a safe integer number of minutes",
  }),
);

const FSRSOptionsSchema = Schema.Struct({
  request_retention: Schema.optional(
    Schema.Finite.pipe(Schema.greaterThan(0), Schema.lessThanOrEqualTo(1)),
  ),
  maximum_interval: Schema.optional(Schema.Int.pipe(Schema.positive())),
  learning_steps: Schema.optional(Schema.Array(StepSchema)),
  relearning_steps: Schema.optional(Schema.Array(StepSchema)),
  enable_fuzz: Schema.optional(Schema.Boolean),
  enable_short_term: Schema.optional(Schema.Boolean),
  w: Schema.optional(Schema.Array(Schema.Finite)),
}) satisfies Schema.Schema<FSRSOptions>;

/** Validate and capture settings when this Effect runs, then create an independent scheduler. */
export const makeScheduler = (
  options: FSRSOptions = {},
): Effect.Effect<Scheduler, SchedulerConfigError> =>
  Effect.gen(function* () {
    const config = yield* Schema.decodeUnknown(FSRSOptionsSchema, {
      onExcessProperty: "error",
    })(options).pipe(Effect.mapError(toSchedulerConfigError));
    const engine = yield* Effect.try({
      try: () => {
        if (config.w !== undefined) checkParameters(config.w);
        return fsrs({
          ...config,
          learning_steps: config.learning_steps && [...config.learning_steps],
          relearning_steps: config.relearning_steps && [...config.relearning_steps],
          w: config.w && [...config.w],
        });
      },
      catch: toSchedulerConfigError,
    });
    return makeSchedulerService(engine);
  });

/** Provide a configured Scheduler; configuration failures remain in the Layer error channel. */
export const makeSchedulerLayer = (
  options: FSRSOptions = {},
): Layer.Layer<Scheduler, SchedulerConfigError> => Layer.effect(Scheduler, makeScheduler(options));

const makeSchedulerService = (engine: FSRS): Scheduler => ({
  isDue: (card, now) => isCardDue(card, now),

  getReviewDate: (card) => computeDueDate(card),

  scheduleReview: (card, grade, now) =>
    Effect.try({
      try: () => {
        const fsrsCard = itemMetadataToFSRSCard(card, now);
        const rating = gradeToRating(grade);
        const { card: nextCard, log } = engine.next(fsrsCard, now, rating);
        // ts-fsrs can exceed its maximum when it separates the grade intervals.
        // Apply the cap after scheduling so the persisted deadline respects it.
        const due = new Date(
          Math.min(
            nextCard.due.getTime(),
            now.getTime() + engine.parameters.maximum_interval * 86_400_000,
          ),
        );

        return {
          updatedCard: fsrsCardToItemMetadata(card, { ...nextCard, due }, now),
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

/** Default scheduling policy, retaining an infallible Layer for existing applications. */
export const SchedulerLive: Layer.Layer<Scheduler> = Layer.effect(
  Scheduler,
  makeScheduler().pipe(Effect.orDie),
);
