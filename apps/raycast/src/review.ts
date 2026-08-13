import type { FSRSGrade } from "@re/workspace";
import { Effect } from "effect";

import {
  ReviewStore,
  type ReviewCardContent,
  type ReviewCardReference,
  type ReviewSession,
} from "./review-store";

export type StartReviewUiResult =
  | { readonly _tag: "ReviewStarted"; readonly session: ReviewSession }
  | { readonly _tag: "ReviewStartError"; readonly message: string };

export type LoadReviewCardUiResult =
  | { readonly _tag: "ReviewCardLoaded"; readonly card: ReviewCardContent }
  | { readonly _tag: "ReviewCardLoadError"; readonly message: string };

export type GradeReviewCardUiResult =
  | { readonly _tag: "ReviewCardGraded" }
  | { readonly _tag: "ReviewGradeError"; readonly message: string };

export type ReviewStatusUiResult =
  | {
      readonly _tag: "ReviewStatusLoaded";
      readonly due: number;
      readonly new: number;
      readonly unavailableDecks: number;
    }
  | { readonly _tag: "ReviewStatusError"; readonly message: string };

export const getReviewStatusForUi = (
  workspacePath: string,
  now = new Date(),
): Effect.Effect<ReviewStatusUiResult, never, ReviewStore> =>
  ReviewStore.pipe(
    Effect.flatMap((reviews) => reviews.startSession(workspacePath, now)),
    Effect.map(
      (session): ReviewStatusUiResult => ({
        _tag: "ReviewStatusLoaded",
        due: session.totalDue,
        new: session.totalNew,
        unavailableDecks: session.issues.length,
      }),
    ),
    Effect.catchTag("ReviewWorkspaceError", (error) =>
      Effect.succeed<ReviewStatusUiResult>({
        _tag: "ReviewStatusError",
        message: error.message,
      }),
    ),
  );

export const startReviewForUi = (
  workspacePath: string,
  now = new Date(),
): Effect.Effect<StartReviewUiResult, never, ReviewStore> =>
  ReviewStore.pipe(
    Effect.flatMap((reviews) => reviews.startSession(workspacePath, now)),
    Effect.map(
      (session): StartReviewUiResult => ({
        _tag: "ReviewStarted",
        session,
      }),
    ),
    Effect.catchTag("ReviewWorkspaceError", (error) =>
      Effect.succeed<StartReviewUiResult>({
        _tag: "ReviewStartError",
        message: error.message,
      }),
    ),
  );

export const loadReviewCardForUi = (
  rootPath: string,
  card: ReviewCardReference,
): Effect.Effect<LoadReviewCardUiResult, never, ReviewStore> =>
  ReviewStore.pipe(
    Effect.flatMap((reviews) => reviews.loadCard(rootPath, card)),
    Effect.map(
      (loaded): LoadReviewCardUiResult => ({
        _tag: "ReviewCardLoaded",
        card: loaded,
      }),
    ),
    Effect.catchTag("ReviewCardLoadError", (error) =>
      Effect.succeed<LoadReviewCardUiResult>({
        _tag: "ReviewCardLoadError",
        message: error.message,
      }),
    ),
  );

export const gradeReviewCardForUi = (
  card: ReviewCardReference,
  grade: FSRSGrade,
  now = new Date(),
): Effect.Effect<GradeReviewCardUiResult, never, ReviewStore> =>
  ReviewStore.pipe(
    Effect.flatMap((reviews) => reviews.gradeCard(card, grade, now)),
    Effect.as<GradeReviewCardUiResult>({ _tag: "ReviewCardGraded" }),
    Effect.catchTag("ReviewGradeError", (error) =>
      Effect.succeed<GradeReviewCardUiResult>({
        _tag: "ReviewGradeError",
        message: error.message,
      }),
    ),
  );
