import {
  Scheduler,
  type SchedulerLog,
  type FSRSGrade,
  type ScheduleError,
} from "../scheduler/index.js";
import { Effect } from "effect";
import type {
  Grade,
  ResponseValidationError,
  ItemMetadata,
  ItemCardCountMismatch,
  NoMatchingTypeError,
} from "../core/index.js";
import {
  annotateBuiltinCardSpecs,
  resolveBuiltinCard,
} from "../item-types/resolve-builtin-item.js";
import type { BuiltinCardNotFound, BuiltinCardSpec } from "../item-types/resolve-builtin-item.js";
import { DeckManager, type CardNotFound, type WriteError, type ReadError } from "./DeckManager.js";
import {
  DEFAULT_REVIEW_QUEUE_OPTIONS,
  ReviewQueueBuilder,
  type ReviewQueueOptions,
} from "./reviewQueue.js";

export interface ReviewCardReference {
  readonly deckPath: string;
  readonly cardId: string;
  readonly cardKey: string;
}

export interface PreparedReviewCard {
  readonly reference: ReviewCardReference;
  readonly deckName: string;
  readonly relativePath: string;
  readonly category: "new" | "due";
  /** Preparation-time snapshot. Freshness-sensitive callers re-read through DeckManager. */
  readonly content: Pick<BuiltinCardSpec, "prompt" | "reveal" | "cardType">;
}

export type ReviewPreparationIssue =
  | { readonly kind: "deck"; readonly deckPath: string; readonly error: ReadError }
  | {
      readonly kind: "card";
      readonly deckPath: string;
      readonly relativePath: string;
      readonly cardId: string;
      readonly error: NoMatchingTypeError | ItemCardCountMismatch | BuiltinCardNotFound;
    };

export interface PreparedReviewQueue {
  readonly cards: readonly PreparedReviewCard[];
  readonly totalNew: number;
  readonly totalDue: number;
  readonly issues: readonly ReviewPreparationIssue[];
}

/** Recoverable failures become issues; defects and interruption still propagate. */
export const prepareBuiltinReviewQueue: (input: {
  readonly rootPath: string;
  readonly deckPaths: readonly string[];
  readonly now: Date;
  readonly options?: ReviewQueueOptions;
}) => Effect.Effect<PreparedReviewQueue, never, ReviewQueueBuilder> = Effect.fn(
  "prepareBuiltinReviewQueue",
)(function* ({ rootPath, deckPaths, now, options = DEFAULT_REVIEW_QUEUE_OPTIONS }) {
  const builder = yield* ReviewQueueBuilder;
  const queue = yield* builder.buildQueue({
    rootPath,
    deckPaths,
    now,
    options: { ...options, cardLimit: null },
  });
  const resolved = yield* annotateBuiltinCardSpecs(queue.items);
  const selected =
    options.cardLimit === null ? resolved.items : resolved.items.slice(0, options.cardLimit);
  const cards = selected.map(
    ({ entry, spec }): PreparedReviewCard => ({
      reference: { deckPath: entry.deckPath, cardId: entry.card.id, cardKey: spec.key },
      deckName: entry.deckName,
      relativePath: entry.relativePath,
      category: entry.category,
      content: { prompt: spec.prompt, reveal: spec.reveal, cardType: spec.cardType },
    }),
  );
  return {
    cards,
    totalNew: cards.filter((card) => card.category === "new").length,
    totalDue: cards.filter((card) => card.category === "due").length,
    issues: [
      ...queue.deckErrors.map(
        (error): ReviewPreparationIssue => ({ kind: "deck", deckPath: error.deckPath, error }),
      ),
      ...resolved.errors.map(
        ({ entry, error }): ReviewPreparationIssue => ({
          kind: "card",
          deckPath: entry.deckPath,
          relativePath: entry.relativePath,
          cardId: entry.card.id,
          error,
        }),
      ),
    ],
  };
});

export type BuiltinReviewGradeError =
  | WriteError
  | CardNotFound
  | NoMatchingTypeError
  | ItemCardCountMismatch
  | BuiltinCardNotFound
  | ResponseValidationError
  | ScheduleError;

export interface BuiltinReviewGradeResult {
  readonly previousCard: ItemMetadata;
  readonly updatedCard: ItemMetadata;
  readonly schedulerLog: SchedulerLog;
  readonly grade: FSRSGrade;
}

/**
 * Re-resolves identity and schedules current metadata under the deck lock.
 * Content edits are permitted while identity still resolves; this does not check
 * whether the caller displayed an older version. Returns only after persistence.
 */
export const gradeBuiltinCard: (
  reference: ReviewCardReference,
  grade: Grade,
  now: Date,
) => Effect.Effect<BuiltinReviewGradeResult, BuiltinReviewGradeError, DeckManager | Scheduler> =
  Effect.fn("gradeBuiltinCard")(function* (reference, grade, now) {
    const manager = yield* DeckManager;
    const scheduler = yield* Scheduler;
    return yield* manager.modifyCardMetadata(
      reference.deckPath,
      reference.cardId,
      ({ item, card }) =>
        Effect.gen(function* () {
          const { spec } = yield* resolveBuiltinCard(item, reference);
          const evaluatedGrade = yield* spec.evaluate(grade);
          const scheduled = yield* scheduler.scheduleReview(card, evaluatedGrade, now);
          return {
            metadata: scheduled.updatedCard,
            result: { ...scheduled, previousCard: card, grade: evaluatedGrade },
          };
        }),
    );
  });
