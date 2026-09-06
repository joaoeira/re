import { FileSystem, Path } from "@effect/platform";
import {
  adaptItemType,
  reconcileCards,
  createMetadata,
  type Item,
  type ItemMetadata,
  type EvaluableItemType,
} from "@simbyotic/re/core";
import {
  ClozeType,
  QAType,
  annotateBuiltinCardKeys,
  resolveBuiltinCard,
} from "@simbyotic/re/item-types";
import { Scheduler, type FSRSGrade } from "@simbyotic/re/scheduler";
import {
  DeckManager,
  ReviewQueueBuilder,
  snapshotWorkspace,
  toScanDecksErrorMessage,
  type RemovedDeckItem,
} from "@simbyotic/re/workspace";
import { Context, Data, Effect, Layer, Option } from "effect";

import { prepareMarkdownForRaycast } from "./raycast-markdown";

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

export const ReviewStore = Context.GenericTag<ReviewStore>("@re/raycast/ReviewStore");

const QA_SEPARATOR = "\n---\n";

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
    const question = draft.question.trim();
    const answer = draft.answer.trim();

    if (question.length === 0) {
      return yield* new ReviewEditValidationError({
        field: "question",
        message: "Enter a question.",
      });
    }
    if (answer.length === 0) {
      return yield* new ReviewEditValidationError({
        field: "answer",
        message: "Enter an answer.",
      });
    }
    if (question.includes(QA_SEPARATOR)) {
      return yield* new ReviewEditValidationError({
        field: "question",
        message: "A question cannot contain a line consisting only of ---.",
      });
    }

    const content = `${question}${QA_SEPARATOR}${answer}`;
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

export const ReviewStoreLive: Layer.Layer<
  ReviewStore,
  never,
  ReviewQueueBuilder | DeckManager | Scheduler | FileSystem.FileSystem | Path.Path
> = Layer.effect(
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

      const queue = yield* queueBuilder.buildQueue({
        deckPaths: validDeckPaths,
        rootPath: snapshot.rootPath,
        now,
      });

      const { items, errors } = yield* annotateBuiltinCardKeys(queue.items);
      return {
        rootPath: snapshot.rootPath,
        cards: items.map(
          (item): ReviewCardReference => ({
            deckPath: item.deckPath,
            deckName: item.deckName,
            relativePath: item.relativePath,
            cardId: item.card.id,
            cardKey: item.cardKey,
          }),
        ),
        totalNew: items.filter((item) => item.category === "new").length,
        totalDue: items.filter((item) => item.category === "due").length,
        totalCards,
        issues: [
          ...issues,
          ...queue.deckErrors.map(
            (error): ReviewDeckIssue => ({
              deckPath: error.deckPath,
              relativePath: pathService.relative(snapshot.rootPath, error.deckPath),
              kind: "read_error",
              message: error.message || "Deck could not be read.",
            }),
          ),
          ...errors.map(
            ({ entry, error }): ReviewDeckIssue => ({
              deckPath: entry.deckPath,
              relativePath: entry.relativePath,
              kind: "parse_error",
              message: `Card ${entry.card.id}: ${error.message}`,
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
        Effect.catchTags({
          DeckNotFound: () =>
            Effect.fail(
              new ReviewCardLoadError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "The deck no longer exists.",
              }),
            ),
          DeckReadError: (error) =>
            Effect.fail(
              new ReviewCardLoadError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: `Could not read the deck: ${error.message}`,
              }),
            ),
          DeckParseError: (error) =>
            Effect.fail(
              new ReviewCardLoadError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: `The deck metadata is invalid: ${error.message}`,
              }),
            ),
        }),
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
      if (cardSpec.cardType !== "qa" && cardSpec.cardType !== "cloze") {
        return yield* new ReviewCardLoadError({
          deckPath: reference.deckPath,
          cardId: reference.cardId,
          message: "The card content no longer matches its scheduling metadata.",
        });
      }

      const prepareMarkdown = (markdown: string) =>
        prepareMarkdownForRaycast(
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
                message: `Could not prepare the card for Raycast: ${error.message}`,
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
                  message: "Editing cannot add, remove, or renumber cloze indices during a review.",
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
            DeckNotFound: () =>
              Effect.fail(
                new ReviewEditError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: "The deck no longer exists.",
                }),
              ),
            DeckReadError: (error) =>
              Effect.fail(
                new ReviewEditError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: `Could not read the deck: ${error.message}`,
                }),
              ),
            DeckParseError: (error) =>
              Effect.fail(
                new ReviewEditError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: `The deck metadata is invalid: ${error.message}`,
                }),
              ),
            DeckWriteError: (error) =>
              Effect.fail(
                new ReviewEditError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: `Could not save the card: ${error.message}`,
                }),
              ),
            CardNotFound: () =>
              Effect.fail(
                new ReviewEditError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: "The card no longer exists in its deck.",
                }),
              ),
            ItemValidationError: (error) =>
              Effect.fail(
                new ReviewEditError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: error.message,
                }),
              ),
          }),
        );
    });

    const gradeCard = Effect.fn("ReviewStore.gradeCard")(function* (
      reference: ReviewCardReference,
      grade: FSRSGrade,
      now: Date,
    ) {
      const scheduled = yield* deckManager
        .modifyCardMetadata(reference.deckPath, reference.cardId, ({ item, card }) =>
          Effect.gen(function* () {
            const { spec } = yield* resolveBuiltinCard(item, reference);
            const evaluatedGrade = yield* spec.evaluate(grade);
            const result = yield* scheduler.scheduleReview(card, evaluatedGrade, now);
            return { metadata: result.updatedCard, result };
          }).pipe(
            Effect.mapError(
              (error) =>
                new ReviewGradeError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: error.message,
                }),
            ),
          ),
        )
        .pipe(
          Effect.catchTags({
            DeckNotFound: () =>
              Effect.fail(
                new ReviewGradeError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: "The deck no longer exists.",
                }),
              ),
            DeckReadError: (error) =>
              Effect.fail(
                new ReviewGradeError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: `Could not read the deck: ${error.message}`,
                }),
              ),
            DeckParseError: (error) =>
              Effect.fail(
                new ReviewGradeError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: `The deck metadata is invalid: ${error.message}`,
                }),
              ),
            DeckWriteError: (error) =>
              Effect.fail(
                new ReviewGradeError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: `Could not write the review: ${error.message}`,
                }),
              ),
            CardNotFound: () =>
              Effect.fail(
                new ReviewGradeError({
                  deckPath: reference.deckPath,
                  cardId: reference.cardId,
                  message: "The card no longer exists in its deck.",
                }),
              ),
          }),
        );

      return {
        card: reference,
        previousMetadata: scheduled.schedulerLog.previousCard,
      } satisfies ReviewUndoToken;
    });

    const undoGrade = Effect.fn("ReviewStore.undoGrade")(function* (undo: ReviewUndoToken) {
      yield* deckManager
        .updateCardMetadata(undo.card.deckPath, undo.card.cardId, undo.previousMetadata)
        .pipe(
          Effect.catchTags({
            DeckNotFound: () =>
              Effect.fail(
                new ReviewUndoError({
                  deckPath: undo.card.deckPath,
                  cardId: undo.card.cardId,
                  message: "The deck no longer exists.",
                }),
              ),
            DeckReadError: (error) =>
              Effect.fail(
                new ReviewUndoError({
                  deckPath: undo.card.deckPath,
                  cardId: undo.card.cardId,
                  message: `Could not read the deck: ${error.message}`,
                }),
              ),
            DeckParseError: (error) =>
              Effect.fail(
                new ReviewUndoError({
                  deckPath: undo.card.deckPath,
                  cardId: undo.card.cardId,
                  message: `The deck metadata is invalid: ${error.message}`,
                }),
              ),
            DeckWriteError: (error) =>
              Effect.fail(
                new ReviewUndoError({
                  deckPath: undo.card.deckPath,
                  cardId: undo.card.cardId,
                  message: `Could not undo the review: ${error.message}`,
                }),
              ),
            CardNotFound: () =>
              Effect.fail(
                new ReviewUndoError({
                  deckPath: undo.card.deckPath,
                  cardId: undo.card.cardId,
                  message: "The card no longer exists in its deck.",
                }),
              ),
          }),
        );
    });

    const deleteItem = Effect.fn("ReviewStore.deleteItem")(function* (
      reference: ReviewCardReference,
    ) {
      const removed = yield* deckManager.removeItem(reference.deckPath, reference.cardId).pipe(
        Effect.catchTags({
          DeckNotFound: () =>
            Effect.fail(
              new ReviewDeleteError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "The deck no longer exists.",
              }),
            ),
          DeckReadError: (error) =>
            Effect.fail(
              new ReviewDeleteError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: `Could not read the deck: ${error.message}`,
              }),
            ),
          DeckParseError: (error) =>
            Effect.fail(
              new ReviewDeleteError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: `The deck metadata is invalid: ${error.message}`,
              }),
            ),
          DeckWriteError: (error) =>
            Effect.fail(
              new ReviewDeleteError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: `Could not delete the card: ${error.message}`,
              }),
            ),
          CardNotFound: () =>
            Effect.fail(
              new ReviewDeleteError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "The card no longer exists in its deck.",
              }),
            ),
        }),
      );

      return { card: reference, removed } satisfies ReviewDeleteUndoToken;
    });

    const undoDelete = Effect.fn("ReviewStore.undoDelete")(function* (undo: ReviewDeleteUndoToken) {
      yield* deckManager.restoreItem(undo.card.deckPath, undo.removed).pipe(
        Effect.catchTags({
          DeckNotFound: () =>
            Effect.fail(
              new ReviewDeleteUndoError({
                deckPath: undo.card.deckPath,
                cardId: undo.card.cardId,
                message: "The deck no longer exists.",
              }),
            ),
          DeckReadError: (error) =>
            Effect.fail(
              new ReviewDeleteUndoError({
                deckPath: undo.card.deckPath,
                cardId: undo.card.cardId,
                message: `Could not read the deck: ${error.message}`,
              }),
            ),
          DeckParseError: (error) =>
            Effect.fail(
              new ReviewDeleteUndoError({
                deckPath: undo.card.deckPath,
                cardId: undo.card.cardId,
                message: `The deck metadata is invalid: ${error.message}`,
              }),
            ),
          DeckWriteError: (error) =>
            Effect.fail(
              new ReviewDeleteUndoError({
                deckPath: undo.card.deckPath,
                cardId: undo.card.cardId,
                message: `Could not restore the deleted card: ${error.message}`,
              }),
            ),
        }),
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
