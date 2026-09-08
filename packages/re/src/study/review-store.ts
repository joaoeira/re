import { FileSystem, Path } from "@effect/platform";
import {
  adaptItemType,
  reconcileCards,
  createMetadata,
  type Item,
  type ItemMetadata,
  type EvaluableItemType,
} from "../core/index.js";
import { ClozeType, QAType, composeQA, resolveBuiltinCard } from "../item-types/index.js";
import { Scheduler, type FSRSGrade } from "../scheduler/index.js";
import {
  DeckManager,
  ReviewQueueBuilder,
  snapshotWorkspace,
  toScanDecksErrorMessage,
  prepareBuiltinReviewQueue,
  gradeBuiltinCard,
  toReadErrorMessage,
  toWriteErrorMessage,
  type WriteError,
  type CardNotFound,
  type ItemValidationError,
  type RemovedDeckItem,
} from "../workspace/index.js";
import { Context, Data, Effect, Layer, Option } from "effect";

export type ReviewMarkdownTransform = (
  context: { readonly rootPath: string; readonly deckPath: string },
  markdown: string,
) => Effect.Effect<string, { readonly message: string }, Path.Path>;

export interface ReviewCardReference {
  readonly deckPath: string;
  readonly deckName: string;
  readonly relativePath: string;
  readonly cardId: string;
  readonly cardKey: string;
}

export interface ReviewDeckIssue {
  readonly deckPath: string;
  readonly relativePath: string;
  readonly kind: "read_error" | "parse_error";
  readonly message: string;
}

export interface ReviewSession {
  readonly rootPath: string;
  readonly cards: readonly ReviewCardReference[];
  readonly totalNew: number;
  readonly totalDue: number;
  readonly totalCards: number;
  readonly issues: readonly ReviewDeckIssue[];
}

export interface ReviewCardContent {
  readonly prompt: string;
  readonly reveal: string;
  readonly cardType: "qa" | "cloze";
  readonly sourceCardIds: readonly string[];
  readonly draft: ReviewCardDraft;
}

export type ReviewCardDraft =
  | {
      readonly cardType: "qa";
      readonly question: string;
      readonly answer: string;
    }
  | {
      readonly cardType: "cloze";
      readonly content: string;
    };

export interface ReviewUndoToken {
  readonly card: ReviewCardReference;
  readonly previousMetadata: ItemMetadata;
}

export interface ReviewDeleteUndoToken {
  readonly card: ReviewCardReference;
  readonly removed: RemovedDeckItem;
}

export class ReviewWorkspaceError extends Data.TaggedError("ReviewWorkspaceError")<{
  readonly message: string;
}> {}

export class ReviewCardLoadError extends Data.TaggedError("ReviewCardLoadError")<{
  readonly deckPath: string;
  readonly cardId: string;
  readonly message: string;
}> {}

export class ReviewGradeError extends Data.TaggedError("ReviewGradeError")<{
  readonly deckPath: string;
  readonly cardId: string;
  readonly message: string;
}> {}

export class ReviewUndoError extends Data.TaggedError("ReviewUndoError")<{
  readonly deckPath: string;
  readonly cardId: string;
  readonly message: string;
}> {}

export class ReviewDeleteError extends Data.TaggedError("ReviewDeleteError")<{
  readonly deckPath: string;
  readonly cardId: string;
  readonly message: string;
}> {}

export class ReviewDeleteUndoError extends Data.TaggedError("ReviewDeleteUndoError")<{
  readonly deckPath: string;
  readonly cardId: string;
  readonly message: string;
}> {}

export class ReviewEditValidationError extends Data.TaggedError("ReviewEditValidationError")<{
  readonly field: "question" | "answer" | "content";
  readonly message: string;
}> {}

export class ReviewEditError extends Data.TaggedError("ReviewEditError")<{
  readonly deckPath: string;
  readonly cardId: string;
  readonly message: string;
}> {}

export interface ReviewStore {
  readonly startSession: (
    workspacePath: string,
    now: Date,
  ) => Effect.Effect<ReviewSession, ReviewWorkspaceError>;
  readonly loadCard: (
    rootPath: string,
    card: ReviewCardReference,
  ) => Effect.Effect<ReviewCardContent, ReviewCardLoadError>;
  readonly saveEdit: (
    card: ReviewCardReference,
    draft: ReviewCardDraft,
  ) => Effect.Effect<void, ReviewEditValidationError | ReviewEditError>;
  readonly gradeCard: (
    card: ReviewCardReference,
    grade: FSRSGrade,
    now: Date,
  ) => Effect.Effect<ReviewUndoToken, ReviewGradeError>;
  readonly undoGrade: (undo: ReviewUndoToken) => Effect.Effect<void, ReviewUndoError>;
  readonly deleteItem: (
    card: ReviewCardReference,
  ) => Effect.Effect<ReviewDeleteUndoToken, ReviewDeleteError>;
  readonly undoDelete: (undo: ReviewDeleteUndoToken) => Effect.Effect<void, ReviewDeleteUndoError>;
}

export const ReviewStore = Context.GenericTag<ReviewStore>("@re/study/ReviewStore");

interface PreparedReviewEdit {
  readonly cardType: "qa" | "cloze";
  readonly content: string;
  readonly itemType: EvaluableItemType;
  readonly cardKeys: readonly string[];
}

const formatContentParseError = (error: {
  readonly message: string;
  readonly fragment?: string;
}) => {
  const fragment = error.fragment === undefined ? "" : ` — ${error.fragment}`;
  return `${error.message}${fragment}`;
};

const prepareReviewEdit = Effect.fn("ReviewStore.prepareEdit")(function* (draft: ReviewCardDraft) {
  if (draft.cardType === "qa") {
    const content = yield* composeQA(draft.question, draft.answer).pipe(
      Effect.mapError(
        (error) => new ReviewEditValidationError({ field: error.field, message: error.message }),
      ),
    );
    const parsed = yield* QAType.parse(content).pipe(
      Effect.mapError(
        (error) =>
          new ReviewEditValidationError({
            field: "question",
            message: formatContentParseError(error),
          }),
      ),
    );

    return {
      cardType: "qa",
      content,
      itemType: adaptItemType(QAType),
      cardKeys: QAType.cards(parsed).map((card) => card.key),
    } satisfies PreparedReviewEdit;
  }

  if (draft.content.trim().length === 0) {
    return yield* new ReviewEditValidationError({
      field: "content",
      message: "Enter cloze content.",
    });
  }

  const parsed = yield* ClozeType.parse(draft.content).pipe(
    Effect.mapError(
      (error) =>
        new ReviewEditValidationError({
          field: "content",
          message: formatContentParseError(error),
        }),
    ),
  );

  return {
    cardType: "cloze",
    content: draft.content,
    itemType: adaptItemType(ClozeType),
    cardKeys: ClozeType.cards(parsed).map((card) => card.key),
  } satisfies PreparedReviewEdit;
});

const sameKeys = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const findItemByCardId = (items: readonly Item[], cardId: string) => {
  for (const item of items) {
    const card = item.cards.find((card) => card.id === cardId);
    if (card) return { item, card };
  }
  return null;
};

export const makeReviewStoreLive = (
  transform: ReviewMarkdownTransform,
): Layer.Layer<
  ReviewStore,
  never,
  ReviewQueueBuilder | DeckManager | Scheduler | FileSystem.FileSystem | Path.Path
> =>
  Layer.effect(
    ReviewStore,
    Effect.gen(function* () {
      const queueBuilder = yield* ReviewQueueBuilder;
      const deckManager = yield* DeckManager;
      const scheduler = yield* Scheduler;
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;

      const startSession = Effect.fn("ReviewStore.startSession")(function* (
        workspacePath: string,
        now: Date,
      ) {
        const snapshot = yield* snapshotWorkspace(workspacePath, { asOf: now }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, pathService),
          Effect.mapError(
            (error) => new ReviewWorkspaceError({ message: toScanDecksErrorMessage(error) }),
          ),
        );

        const validDeckPaths = snapshot.decks
          .filter((deck) => deck.status === "ok")
          .map((deck) => deck.absolutePath);
        const totalCards = snapshot.decks.reduce(
          (total, deck) => total + (deck.status === "ok" ? deck.totalCards : 0),
          0,
        );
        const issues: ReviewDeckIssue[] = snapshot.decks.flatMap((deck) =>
          deck.status === "ok"
            ? []
            : [
                {
                  deckPath: deck.absolutePath,
                  relativePath: deck.relativePath,
                  kind: deck.status,
                  message: deck.message,
                },
              ],
        );

        const queue = yield* prepareBuiltinReviewQueue({
          deckPaths: validDeckPaths,
          rootPath: snapshot.rootPath,
          now,
        }).pipe(Effect.provideService(ReviewQueueBuilder, queueBuilder));

        return {
          rootPath: snapshot.rootPath,
          cards: queue.cards.map(
            (card): ReviewCardReference => ({
              ...card.reference,
              deckName: card.deckName,
              relativePath: card.relativePath,
            }),
          ),
          totalNew: queue.totalNew,
          totalDue: queue.totalDue,
          totalCards,
          issues: [
            ...issues,
            ...queue.issues.map(
              (issue): ReviewDeckIssue => ({
                deckPath: issue.deckPath,
                relativePath:
                  issue.kind === "card"
                    ? issue.relativePath
                    : pathService.relative(snapshot.rootPath, issue.deckPath),
                kind: issue.kind === "card" ? "parse_error" : "read_error",
                message:
                  issue.kind === "card"
                    ? `Card ${issue.cardId}: ${issue.error.message}`
                    : toReadErrorMessage(issue.error),
              }),
            ),
          ],
        } satisfies ReviewSession;
      });

      const loadCard = Effect.fn("ReviewStore.loadCard")(function* (
        rootPath: string,
        reference: ReviewCardReference,
      ) {
        const parsed = yield* deckManager.readDeck(reference.deckPath).pipe(
          Effect.mapError(
            (error) =>
              new ReviewCardLoadError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: toReadErrorMessage(error),
              }),
          ),
        );
        const found = findItemByCardId(parsed.items, reference.cardId);

        if (found === null) {
          return yield* new ReviewCardLoadError({
            deckPath: reference.deckPath,
            cardId: reference.cardId,
            message: "The card no longer exists in its deck.",
          });
        }

        const { spec: cardSpec } = yield* resolveBuiltinCard(found.item, reference).pipe(
          Effect.mapError(
            (error) =>
              new ReviewCardLoadError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: error.message,
              }),
          ),
        );
        const prepareMarkdown = (markdown: string) =>
          transform(
            {
              rootPath,
              deckPath: reference.deckPath,
            },
            markdown,
          ).pipe(
            Effect.provideService(Path.Path, pathService),
            Effect.mapError(
              (error) =>
                new ReviewCardLoadError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: `Could not prepare the card: ${error.message}`,
                }),
            ),
          );

        const prompt = yield* prepareMarkdown(cardSpec.prompt);
        const reveal = yield* prepareMarkdown(cardSpec.reveal);
        const draft: ReviewCardDraft =
          cardSpec.cardType === "qa"
            ? yield* QAType.parse(found.item.content).pipe(
                Effect.map(
                  ({ question, answer }): ReviewCardDraft => ({
                    cardType: "qa",
                    question,
                    answer,
                  }),
                ),
                Effect.mapError(
                  () =>
                    new ReviewCardLoadError({
                      deckPath: reference.deckPath,
                      cardId: reference.cardId,
                      message: "The card content is not valid Q&A content.",
                    }),
                ),
              )
            : { cardType: "cloze", content: found.item.content };

        return {
          prompt,
          reveal,
          cardType: cardSpec.cardType,
          sourceCardIds: found.item.cards.map((card) => card.id),
          draft,
        } satisfies ReviewCardContent;
      });

      const saveEdit = Effect.fn("ReviewStore.saveEdit")(function* (
        reference: ReviewCardReference,
        draft: ReviewCardDraft,
      ) {
        const prepared = yield* prepareReviewEdit(draft);
        const mapPersistenceError = (error: WriteError | CardNotFound | ItemValidationError) =>
          Effect.fail(
            new ReviewEditError({
              deckPath: reference.deckPath,
              cardId: reference.cardId,
              message: toWriteErrorMessage(error),
            }),
          );
        yield* deckManager
          .modifyItem(
            reference.deckPath,
            reference.cardId,
            (current) =>
              Effect.gen(function* () {
                const original = yield* resolveBuiltinCard(current, reference).pipe(
                  Effect.mapError(
                    (error) =>
                      new ReviewEditError({
                        deckPath: reference.deckPath,
                        cardId: reference.cardId,
                        message: error.message,
                      }),
                  ),
                );
                if (original.type.name !== prepared.cardType) {
                  return yield* new ReviewEditError({
                    deckPath: reference.deckPath,
                    cardId: reference.cardId,
                    message: "The card type changed while it was being edited.",
                  });
                }

                const originalKeys = original.cards.map((card) => card.key);
                if (!sameKeys(originalKeys, prepared.cardKeys)) {
                  return yield* new ReviewEditValidationError({
                    field: "content",
                    message:
                      "Editing cannot add, remove, or renumber cloze indices during a review.",
                  });
                }
                const matches = yield* reconcileCards(
                  { keys: originalKeys, cards: current.cards },
                  prepared.cardKeys,
                ).pipe(
                  Effect.mapError(
                    (error) =>
                      new ReviewEditError({
                        deckPath: reference.deckPath,
                        cardId: reference.cardId,
                        message: error.message,
                      }),
                  ),
                );
                return {
                  content: prepared.content,
                  cards: matches.map((match) => Option.getOrElse(match, createMetadata)),
                };
              }),
            prepared.itemType,
          )
          .pipe(
            Effect.catchTags({
              DeckNotFound: mapPersistenceError,
              DeckReadError: mapPersistenceError,
              DeckParseError: mapPersistenceError,
              DeckWriteError: mapPersistenceError,
              CardNotFound: mapPersistenceError,
              ItemValidationError: mapPersistenceError,
            }),
          );
      });

      const gradeCard = Effect.fn("ReviewStore.gradeCard")(function* (
        reference: ReviewCardReference,
        grade: FSRSGrade,
        now: Date,
      ) {
        const mapPersistenceError = (error: WriteError | CardNotFound) =>
          Effect.fail(new Error(toWriteErrorMessage(error)));
        const scheduled = yield* gradeBuiltinCard(reference, grade, now).pipe(
          Effect.provideService(DeckManager, deckManager),
          Effect.provideService(Scheduler, scheduler),
          Effect.catchTags({
            DeckNotFound: mapPersistenceError,
            DeckReadError: mapPersistenceError,
            DeckParseError: mapPersistenceError,
            DeckWriteError: mapPersistenceError,
            CardNotFound: mapPersistenceError,
          }),
          Effect.mapError(
            (error) =>
              new ReviewGradeError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: error.message,
              }),
          ),
        );

        return {
          card: reference,
          previousMetadata: scheduled.previousCard,
        } satisfies ReviewUndoToken;
      });

      const undoGrade = Effect.fn("ReviewStore.undoGrade")(function* (undo: ReviewUndoToken) {
        yield* deckManager
          .updateCardMetadata(undo.card.deckPath, undo.card.cardId, undo.previousMetadata)
          .pipe(
            Effect.mapError(
              (error) =>
                new ReviewUndoError({
                  deckPath: undo.card.deckPath,
                  cardId: undo.card.cardId,
                  message: toWriteErrorMessage(error),
                }),
            ),
          );
      });

      const deleteItem = Effect.fn("ReviewStore.deleteItem")(function* (
        reference: ReviewCardReference,
      ) {
        const removed = yield* deckManager.removeItem(reference.deckPath, reference.cardId).pipe(
          Effect.mapError(
            (error) =>
              new ReviewDeleteError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: toWriteErrorMessage(error),
              }),
          ),
        );

        return { card: reference, removed } satisfies ReviewDeleteUndoToken;
      });

      const undoDelete = Effect.fn("ReviewStore.undoDelete")(function* (
        undo: ReviewDeleteUndoToken,
      ) {
        yield* deckManager.restoreItem(undo.card.deckPath, undo.removed).pipe(
          Effect.mapError(
            (error) =>
              new ReviewDeleteUndoError({
                deckPath: undo.card.deckPath,
                cardId: undo.card.cardId,
                message: toWriteErrorMessage(error),
              }),
          ),
        );
      });

      return ReviewStore.of({
        startSession,
        loadCard,
        saveEdit,
        gradeCard,
        undoGrade,
        deleteItem,
        undoDelete,
      });
    }),
  );
