import { ClipboardImageReaderLive } from "./clipboard-image";
import { insertImageForUi } from "@simbyotic/re/study";
import {
  ReviewStore,
  makeReviewStoreLive,
  type ReviewUndoToken,
  type ReviewDeleteUndoToken,
  type ReviewCardDraft,
  type ReviewCardReference as StoreReference,
} from "@simbyotic/re/study";
import { DeckStoreLive } from "@simbyotic/re/study";
import { createCardForUi, prepareCard, type CreateCardInput } from "@simbyotic/re/study";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { adaptItemType } from "@simbyotic/re/core";
import { QAType, ClozeType, composeQA } from "@simbyotic/re/item-types";
import { SchedulerLive } from "@simbyotic/re/scheduler";
import {
  DeckManagerLive,
  scanDecks,
  snapshotWorkspace,
  ReviewQueueBuilderLive,
  ShuffledOrderingStrategy,
  mapScanDecksErrorToError,
  prepareBuiltinReviewQueue,
} from "@simbyotic/re/workspace";
import { Effect, Layer, ManagedRuntime } from "effect";
import { gradeValues, type ReviewGrade } from "./review-controls";
import type { Card } from "./cards";

export type Draft =
  | { readonly type: "qa"; readonly question: string; readonly answer: string }
  | { readonly type: "cloze"; readonly content: string };
export interface WorkspaceCard extends Card {
  readonly reference: StoreReference;
}
export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: string; readonly field?: string };
const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const decks = DeckManagerLive.pipe(Layer.provideMerge(platform));
const queue = ReviewQueueBuilderLive.pipe(
  Layer.provideMerge(Layer.merge(decks, ShuffledOrderingStrategy)),
);
const services = Layer.merge(queue, SchedulerLive);
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    services,
    ClipboardImageReaderLive,
    makeReviewStoreLive((_context, markdown) => Effect.succeed(markdown)).pipe(
      Layer.provide(services),
    ),
    DeckStoreLive.pipe(Layer.provide(decks)),
  ),
);
const pending = new Set<Promise<unknown>>();
function run<A>(
  effect: Effect.Effect<A, never, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>,
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
        Effect.map(({ specs }) => {
          const noteId = crypto.randomUUID();
          return specs.map((spec) => ({
            id: crypto.randomUUID(),
            question: spec.prompt,
            answer: spec.reveal,
            cardType: draft.type,
            source: {
              noteId,
              cardKey: spec.key,
              draft:
                draft.type === "qa"
                  ? { cardType: "qa" as const, question: draft.question, answer: draft.answer }
                  : { cardType: "cloze" as const, content: draft.content },
            },
          }));
        }),
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

export const loadReview = (root: string) =>
  run(
    result(
      Effect.gen(function* () {
        const store = yield* ReviewStore;
        const session = yield* store.startSession(root, new Date());
        return {
          cards: session.cards.map(
            (reference): WorkspaceCard => ({
              id: `${reference.deckPath}#${reference.cardId}`,
              reference,
              question: "",
              answer: "",
            }),
          ),
          skipped: session.issues.length,
          issues: session.issues,
        };
      }),
    ),
  );

export const readReviewCard = (root: string, card: WorkspaceCard) =>
  run(result(ReviewStore.pipe(Effect.flatMap((store) => store.loadCard(root, card.reference)))));
export const saveReviewEdit = (
  card: WorkspaceCard,
  draft: ReviewCardDraft,
): Promise<Result<void>> =>
  run(
    ReviewStore.pipe(
      Effect.flatMap((store) => store.saveEdit(card.reference, draft)),
      Effect.as<Result<void>>({ ok: true, value: undefined }),
      Effect.catchTag("ReviewEditValidationError", (error) =>
        Effect.succeed<Result<void>>({ ok: false, error: error.message, field: error.field }),
      ),
      Effect.catch((error) => Effect.succeed<Result<void>>({ ok: false, error: error.message })),
    ),
  );
export const undoReviewGrade = (undo: ReviewUndoToken) =>
  run(result(ReviewStore.pipe(Effect.flatMap((store) => store.undoGrade(undo)))));
export const deleteReviewItem = (card: WorkspaceCard) =>
  run(result(ReviewStore.pipe(Effect.flatMap((store) => store.deleteItem(card.reference)))));
export const restoreReviewItem = (undo: ReviewDeleteUndoToken) =>
  run(result(ReviewStore.pipe(Effect.flatMap((store) => store.undoDelete(undo)))));
export const createWorkspaceCard = (input: CreateCardInput) => run(createCardForUi(input));
export const previewDraft = (input: CreateCardInput) =>
  Effect.runSync(
    prepareCard(input).pipe(
      Effect.flatMap((prepared) => prepared.itemType.parseCards(prepared.content)),
      Effect.map((value) => ({ ok: true as const, value })),
      Effect.catchTags({
        CardFieldError: (error) =>
          Effect.succeed({ ok: false as const, error: error.message, field: error.field }),
        ContentParseError: (error) =>
          Effect.succeed({
            ok: false as const,
            error: error.message,
            field: input.cardType === "cloze" ? "content" : "question",
          }),
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
// session, which is a fixed snapshot of the new/due queue.
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

export const gradeInDeck = (card: WorkspaceCard, grade: ReviewGrade) =>
  run(
    result(
      ReviewStore.pipe(
        Effect.flatMap((store) => store.gradeCard(card.reference, gradeValues[grade], new Date())),
      ),
    ),
  );

export const disposeWorkspace = async () => {
  await Promise.allSettled(pending);
  await runtime.dispose();
};

export const insertClipboardImage = (workspacePath: string, deckPath: string, content: string) =>
  run(insertImageForUi({ workspacePath, deckPath, content }));
