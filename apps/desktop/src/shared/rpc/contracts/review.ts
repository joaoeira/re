import { Schema } from "@effect/schema";
import { rpc } from "electron-effect-rpc/contract";

import {
  BuildReviewQueueResultSchema,
  CardContentErrorSchema,
  CardContentResultSchema,
  FSRSGradeSchema,
  ReviewAssistantSourceCardErrorSchema,
  ReviewAssistantSourceCardResultSchema,
  ReviewCardRefSchema,
  ReviewGeneratePermutationsErrorSchema,
  ReviewGeneratePermutationsInputSchema,
  ReviewGeneratePermutationsResultSchema,
  ReviewHistoryEntrySchema,
  ReviewOperationError,
  ReviewSessionOptionsSchema,
  ReviewStatsSchema,
  SerializedItemMetadataSchema,
  UndoReviewErrorSchema,
} from "@shared/rpc/schemas/review";

export const BuildReviewQueue = rpc(
  "BuildReviewQueue",
  Schema.Struct({
    deckPaths: Schema.Array(Schema.String),
    rootPath: Schema.String,
    options: Schema.optional(ReviewSessionOptionsSchema),
  }),
  BuildReviewQueueResultSchema,
  ReviewOperationError,
);

export const GetCardContent = rpc(
  "GetCardContent",
  ReviewCardRefSchema,
  CardContentResultSchema,
  CardContentErrorSchema,
);

export const GetReviewAssistantSourceCard = rpc(
  "GetReviewAssistantSourceCard",
  ReviewCardRefSchema,
  ReviewAssistantSourceCardResultSchema,
  ReviewAssistantSourceCardErrorSchema,
);

export const ReviewGeneratePermutations = rpc(
  "ReviewGeneratePermutations",
  ReviewGeneratePermutationsInputSchema,
  ReviewGeneratePermutationsResultSchema,
  ReviewGeneratePermutationsErrorSchema,
);

export const ScheduleReview = rpc(
  "ScheduleReview",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
    grade: FSRSGradeSchema,
  }),
  Schema.Struct({
    reviewEntryId: Schema.Union(Schema.Number.pipe(Schema.int(), Schema.positive()), Schema.Null),
    expectedCurrentCardFingerprint: Schema.String,
    previousCardFingerprint: Schema.String,
    previousCard: SerializedItemMetadataSchema,
  }),
  ReviewOperationError,
);

export const UndoReview = rpc(
  "UndoReview",
  Schema.Struct({
    deckPath: Schema.String,
    cardId: Schema.String,
    previousCard: SerializedItemMetadataSchema,
    reviewEntryId: Schema.Union(Schema.Number.pipe(Schema.int(), Schema.positive()), Schema.Null),
    expectedCurrentCardFingerprint: Schema.String,
    previousCardFingerprint: Schema.String,
  }),
  Schema.Struct({}),
  UndoReviewErrorSchema,
);

export const GetReviewStats = rpc(
  "GetReviewStats",
  Schema.Struct({
    rootPath: Schema.String,
    includeUndone: Schema.optional(Schema.Boolean),
  }),
  ReviewStatsSchema,
  ReviewOperationError,
);

export const ListReviewHistory = rpc(
  "ListReviewHistory",
  Schema.Struct({
    rootPath: Schema.String,
    includeUndone: Schema.optional(Schema.Boolean),
    limit: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
    offset: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  }),
  Schema.Struct({
    entries: Schema.Array(ReviewHistoryEntrySchema),
  }),
  ReviewOperationError,
);
