import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { gradeReviewCardForUi, loadReviewCardForUi, startReviewForUi } from "../src/review";
import {
  ReviewCardLoadError,
  ReviewGradeError,
  ReviewStore,
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
    ...service,
  });

describe("Raycast review UI boundary", () => {
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
});
