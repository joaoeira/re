import { describe, expect, it } from "@effect/vitest";
import { createMetadataWithId, type ItemId } from "@re/core";
import { Effect, Layer } from "effect";

import {
  deleteReviewItemForUi,
  getReviewStatusForUi,
  gradeReviewCardForUi,
  loadReviewCardForUi,
  startReviewForUi,
  undoDeleteReviewItemForUi,
  undoReviewCardForUi,
} from "../src/review";
import {
  ReviewCardLoadError,
  ReviewDeleteError,
  ReviewDeleteUndoError,
  ReviewGradeError,
  ReviewStore,
  ReviewUndoError,
  ReviewWorkspaceError,
  type ReviewCardReference,
  type ReviewStore as ReviewStoreService,
} from "../src/review-store";

const reference: ReviewCardReference = {
  deckPath: "/decks/computing.md",
  deckName: "computing",
  relativePath: "computing.md",
  cardId: "effect-card",
  cardIndex: 0,
};

const makeLayer = (service: Partial<ReviewStoreService>): Layer.Layer<ReviewStoreService> =>
  Layer.succeed(ReviewStore, {
    startSession: () =>
      Effect.fail(new ReviewWorkspaceError({ message: "Not configured for this test" })),
    loadCard: () =>
      Effect.fail(
        new ReviewCardLoadError({
          deckPath: reference.deckPath,
          cardId: reference.cardId,
          message: "Not configured for this test",
        }),
      ),
    gradeCard: () =>
      Effect.fail(
        new ReviewGradeError({
          deckPath: reference.deckPath,
          cardId: reference.cardId,
          message: "Not configured for this test",
        }),
      ),
    undoGrade: () =>
      Effect.fail(
        new ReviewUndoError({
          deckPath: reference.deckPath,
          cardId: reference.cardId,
          message: "Not configured for this test",
        }),
      ),
    deleteItem: () =>
      Effect.fail(
        new ReviewDeleteError({
          deckPath: reference.deckPath,
          cardId: reference.cardId,
          message: "Not configured for this test",
        }),
      ),
    undoDelete: () =>
      Effect.fail(
        new ReviewDeleteUndoError({
          deckPath: reference.deckPath,
          cardId: reference.cardId,
          message: "Not configured for this test",
        }),
      ),
    ...service,
  });

describe("Raycast review UI boundary", () => {
  it.effect("reports due, new, and skipped-deck counts for the menu bar", () =>
    Effect.gen(function* () {
      const result = yield* getReviewStatusForUi("/decks", new Date("2026-08-13T12:00:00Z"));

      expect(result).toEqual({
        _tag: "ReviewStatusLoaded",
        due: 12,
        new: 47,
        unavailableDecks: 1,
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          startSession: () =>
            Effect.succeed({
              rootPath: "/decks",
              cards: [],
              totalDue: 12,
              totalNew: 47,
              issues: [
                {
                  deckPath: "/decks/broken.md",
                  relativePath: "broken.md",
                  kind: "parse_error",
                  message: "Invalid metadata",
                },
              ],
            }),
        }),
      ),
    ),
  );

  it.effect("returns workspace failures as UI state", () =>
    Effect.gen(function* () {
      const result = yield* startReviewForUi("/missing");
      expect(result).toEqual({
        _tag: "ReviewStartError",
        message: "Workspace not found",
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          startSession: () =>
            Effect.fail(new ReviewWorkspaceError({ message: "Workspace not found" })),
        }),
      ),
    ),
  );

  it.effect("returns card parsing failures as UI state", () =>
    Effect.gen(function* () {
      const result = yield* loadReviewCardForUi("/decks", reference);
      expect(result).toEqual({
        _tag: "ReviewCardLoadError",
        message: "Malformed cloze",
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          loadCard: () =>
            Effect.fail(
              new ReviewCardLoadError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "Malformed cloze",
              }),
            ),
        }),
      ),
    ),
  );

  it.effect("returns write failures as UI state", () =>
    Effect.gen(function* () {
      const result = yield* gradeReviewCardForUi(reference, 2);
      expect(result).toEqual({
        _tag: "ReviewGradeError",
        message: "Disk is read-only",
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          gradeCard: () =>
            Effect.fail(
              new ReviewGradeError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "Disk is read-only",
              }),
            ),
        }),
      ),
    ),
  );

  it.effect("returns undo failures as UI state", () =>
    Effect.gen(function* () {
      const result = yield* undoReviewCardForUi({
        card: reference,
        previousMetadata: createMetadataWithId(reference.cardId as ItemId),
      });
      expect(result).toEqual({
        _tag: "ReviewUndoError",
        message: "Disk is read-only",
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          undoGrade: () =>
            Effect.fail(
              new ReviewUndoError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "Disk is read-only",
              }),
            ),
        }),
      ),
    ),
  );

  it.effect("returns delete failures as UI state", () =>
    Effect.gen(function* () {
      const result = yield* deleteReviewItemForUi(reference);
      expect(result).toEqual({
        _tag: "ReviewDeleteError",
        message: "Disk is read-only",
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          deleteItem: () =>
            Effect.fail(
              new ReviewDeleteError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "Disk is read-only",
              }),
            ),
        }),
      ),
    ),
  );

  it.effect("returns delete-undo failures as UI state", () =>
    Effect.gen(function* () {
      const result = yield* undoDeleteReviewItemForUi({
        card: reference,
        removed: {
          itemIndex: 0,
          item: {
            cards: [createMetadataWithId(reference.cardId as ItemId)],
            content: "Question\n---\nAnswer\n",
          },
        },
      });
      expect(result).toEqual({
        _tag: "ReviewDeleteUndoError",
        message: "Disk is read-only",
      });
    }).pipe(
      Effect.provide(
        makeLayer({
          undoDelete: () =>
            Effect.fail(
              new ReviewDeleteUndoError({
                deckPath: reference.deckPath,
                cardId: reference.cardId,
                message: "Disk is read-only",
              }),
            ),
        }),
      ),
    ),
  );
});
