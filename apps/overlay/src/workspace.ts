import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { adaptItemType, createMetadata } from "@simbyotic/re/core";
import { QAType, ClozeType, composeQA } from "@simbyotic/re/item-types";
import { SchedulerLive } from "@simbyotic/re/scheduler";
import {
  DeckManager,
  DeckManagerLive,
  scanDecks,
  snapshotWorkspace,
  ReviewQueueBuilderLive,
  ShuffledOrderingStrategy,
  mapScanDecksErrorToError,
  prepareBuiltinReviewQueue,
  gradeBuiltinCard,
  toWriteErrorMessage,
  type CardNotFound,
  type ItemValidationError,
  type ReviewCardReference,
  type WriteError,
} from "@simbyotic/re/workspace";
import { Effect, Layer, ManagedRuntime } from "effect";
import { gradeValues, type ReviewGrade } from "./review-controls";
import type { Card } from "./cards";

export type Draft =
  | { readonly type: "qa"; readonly question: string; readonly answer: string }
  | { readonly type: "cloze"; readonly content: string };
export interface WorkspaceCard extends Card {
  readonly reference: ReviewCardReference;
}
export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: string };
const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const decks = DeckManagerLive.pipe(Layer.provideMerge(platform));
const queue = ReviewQueueBuilderLive.pipe(
  Layer.provideMerge(Layer.merge(decks, ShuffledOrderingStrategy)),
);
const runtime = ManagedRuntime.make(Layer.merge(queue, SchedulerLive));
const pending = new Set<Promise<unknown>>();
function run<A>(
  effect: Effect.Effect<A, never, ManagedRuntime.ManagedRuntime.Context<typeof runtime>>,
): Promise<A> {
  const operation = runtime.runPromise(effect);
  pending.add(operation);
  void operation.then(
    () => pending.delete(operation),
    () => pending.delete(operation),
  );
  return operation;
}

function result<A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Result<A>, never, R> {
  return effect.pipe(
    Effect.match({
      onSuccess: (value): Result<A> => ({ ok: true, value }),
      onFailure: (error): Result<A> => ({ ok: false, error: error.message }),
    }),
  );
}

const persistenceFailure = (error: WriteError | CardNotFound | ItemValidationError) =>
  Effect.fail(new Error(toWriteErrorMessage(error)));

const prepare = (draft: Draft) =>
  Effect.gen(function* () {
    const content =
      draft.type === "qa" ? yield* composeQA(draft.question, draft.answer) : draft.content.trim();
    const type = draft.type === "qa" ? adaptItemType(QAType) : adaptItemType(ClozeType);
    const specs = yield* type.parseCards(content);
    return { content, type, specs };
  });

export const prepareScratch = (draft: Draft): Result<Card[]> =>
  Effect.runSync(
    result(
      prepare(draft).pipe(
        Effect.map(({ specs }) =>
          specs.map((spec) => ({
            id: crypto.randomUUID(),
            question: spec.prompt,
            answer: spec.reveal,
            cardType: draft.type,
          })),
        ),
      ),
    ),
  );

export const listDecks = (root: string) =>
  run(
    result(
      scanDecks(root).pipe(
        Effect.map((scan) => scan.decks),
        Effect.mapError(mapScanDecksErrorToError),
      ),
    ),
  );

export const createInDeck = (path: string, draft: Draft): Promise<Result<number>> =>
  run(
    result(
      Effect.gen(function* () {
        const prepared = yield* prepare(draft);
        const manager = yield* DeckManager;
        yield* manager
          .appendItem(
            path,
            { content: prepared.content, cards: prepared.specs.map(() => createMetadata()) },
            prepared.type,
          )
          .pipe(Effect.catchAll(persistenceFailure));
        return prepared.specs.length;
      }),
    ),
  );

export const loadReview = (
  root: string,
): Promise<Result<{ cards: WorkspaceCard[]; skipped: number }>> =>
  run(
    result(
      Effect.gen(function* () {
        const scan = yield* scanDecks(root).pipe(Effect.mapError(mapScanDecksErrorToError));
        const queue = yield* prepareBuiltinReviewQueue({
          rootPath: root,
          deckPaths: scan.decks.map((deck) => deck.absolutePath),
          now: new Date(),
        });
        return {
          cards: queue.cards.map(
            (card): WorkspaceCard => ({
              id: `${card.reference.deckPath}#${card.reference.cardId}`,
              reference: card.reference,
              question: card.content.prompt,
              answer: card.content.reveal,
              cardType: card.content.cardType,
            }),
          ),
          skipped: queue.issues.length,
        };
      }),
    ),
  );

export interface ReviewStatus {
  readonly due: number;
  readonly new: number;
  readonly total: number;
  readonly unavailableDecks: number;
}

// Match Raycast's status: count reviewable builtin cards, not the in-memory
// session (which may retain an Again card before its next scheduled due time).
export const loadReviewStatus = (root: string, now = new Date()): Promise<Result<ReviewStatus>> =>
  run(
    result(
      Effect.gen(function* () {
        const snapshot = yield* snapshotWorkspace(root, { asOf: now }).pipe(
          Effect.mapError(mapScanDecksErrorToError),
        );
        const valid = snapshot.decks.filter((deck) => deck.status === "ok");
        const queue = yield* prepareBuiltinReviewQueue({
          rootPath: snapshot.rootPath,
          deckPaths: valid.map((deck) => deck.absolutePath),
          now,
        });
        return {
          due: queue.totalDue,
          new: queue.totalNew,
          total: valid.reduce((sum, deck) => sum + deck.totalCards, 0),
          unavailableDecks: snapshot.decks.length - valid.length + queue.issues.length,
        };
      }),
    ),
  );

export const gradeInDeck = (card: WorkspaceCard, grade: ReviewGrade): Promise<Result<void>> =>
  run(
    result(
      gradeBuiltinCard(card.reference, gradeValues[grade], new Date()).pipe(
        Effect.catchTags({
          DeckNotFound: persistenceFailure,
          DeckReadError: persistenceFailure,
          DeckParseError: persistenceFailure,
          DeckWriteError: persistenceFailure,
          CardNotFound: persistenceFailure,
        }),
        Effect.asVoid,
      ),
    ),
  );

export const disposeWorkspace = async () => {
  await Promise.allSettled(pending);
  await runtime.dispose();
};
