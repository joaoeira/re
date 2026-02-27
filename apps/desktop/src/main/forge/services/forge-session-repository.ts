import { Schema } from "@effect/schema";
import * as SqlClient from "@effect/sql/SqlClient";
import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Data, Effect, ManagedRuntime } from "effect";

import {
  ForgeChunkPageBoundarySchema,
  type ForgeChunk,
  type ForgeChunkPageBoundary,
  type ForgeSession,
  type ForgeSessionStatus,
  type ForgeSourceKind,
  type ForgeTopicCardsStatus,
} from "@shared/rpc/schemas/forge";
import { runSqlInRuntimeOrMapRuntimeError } from "@main/sqlite/runtime-runner";
import { toErrorMessage } from "@main/utils/format";

export class ForgeSessionRepositoryError extends Data.TaggedError("ForgeSessionRepositoryError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class ForgeSessionStatusTransitionError extends Data.TaggedError(
  "ForgeSessionStatusTransitionError",
)<{
  readonly sessionId: number;
  readonly fromStatus: ForgeSessionStatus;
  readonly toStatus: ForgeSessionStatus;
}> {}

export class ForgeTopicAlreadyGeneratingRepositoryError extends Data.TaggedError(
  "ForgeTopicAlreadyGeneratingRepositoryError",
)<{
  readonly topicId: number;
}> {}

export type ForgeChunkInsert = {
  readonly text: string;
  readonly sequenceOrder: number;
  readonly pageBoundaries: ReadonlyArray<ForgeChunkPageBoundary>;
};

export type ForgeTopicWrite = {
  readonly sequenceOrder: number;
  readonly topics: ReadonlyArray<string>;
};

export type ForgeChunkTopics = {
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topics: ReadonlyArray<string>;
};

export type ForgeTopicRef = {
  readonly sessionId: number;
  readonly chunkId: number;
  readonly topicIndex: number;
};

export type ForgeTopicRecord = {
  readonly topicId: number;
  readonly sessionId: number;
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topicIndex: number;
  readonly topicText: string;
  readonly chunkText: string;
};

export type ForgeTopicGenerationRow = {
  readonly topicId: number;
  readonly status: ForgeTopicCardsStatus;
  readonly errorMessage: string | null;
  readonly generationStartedAt: string | null;
  readonly statusChangedAt: string;
  readonly generationRevision: number;
};

export type ForgeGeneratedCard = {
  readonly id: number;
  readonly topicId: number;
  readonly cardOrder: number;
  readonly question: string;
  readonly answer: string;
};

export type ForgeTopicCardsSnapshotRow = {
  readonly topicId: number;
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topicIndex: number;
  readonly topicText: string;
  readonly status: ForgeTopicCardsStatus;
  readonly errorMessage: string | null;
  readonly cardCount: number;
  readonly generationRevision: number;
};

export type ForgeTopicCardsResultRow = {
  readonly topic: ForgeTopicCardsSnapshotRow;
  readonly cards: ReadonlyArray<ForgeGeneratedCard>;
};

export type ForgeCardWithTopicContext = ForgeGeneratedCard & {
  readonly sessionId: number;
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topicIndex: number;
  readonly topicText: string;
  readonly chunkText: string;
};

export type ForgeCardPermutation = {
  readonly id: number;
  readonly sourceCardId: number;
  readonly permutationOrder: number;
  readonly question: string;
  readonly answer: string;
};

export type ForgeCardCloze = {
  readonly sourceCardId: number;
  readonly clozeText: string;
};

export interface ForgeSessionRepository {
  readonly createSession: (input: {
    readonly sourceKind: ForgeSourceKind;
    readonly sourceFilePath: string;
    readonly deckPath: string | null;
    readonly sourceFingerprint: string;
  }) => Effect.Effect<ForgeSession, ForgeSessionRepositoryError>;
  readonly findLatestBySourceFingerprint: (input: {
    readonly sourceKind: ForgeSourceKind;
    readonly sourceFingerprint: string;
  }) => Effect.Effect<ForgeSession | null, ForgeSessionRepositoryError>;
  readonly findLatestBySourceFilePath: (input: {
    readonly sourceKind: ForgeSourceKind;
    readonly sourceFilePath: string;
  }) => Effect.Effect<ForgeSession | null, ForgeSessionRepositoryError>;
  readonly getSession: (
    sessionId: number,
  ) => Effect.Effect<ForgeSession | null, ForgeSessionRepositoryError>;
  readonly tryBeginExtraction: (
    sessionId: number,
  ) => Effect.Effect<ForgeSession | null, ForgeSessionRepositoryError>;
  readonly setSessionStatus: (input: {
    readonly sessionId: number;
    readonly status: ForgeSessionStatus;
    readonly errorMessage: string | null;
  }) => Effect.Effect<
    ForgeSession | null,
    ForgeSessionRepositoryError | ForgeSessionStatusTransitionError
  >;
  readonly hasChunks: (sessionId: number) => Effect.Effect<boolean, ForgeSessionRepositoryError>;
  readonly saveChunks: (
    sessionId: number,
    chunks: ReadonlyArray<ForgeChunkInsert>,
  ) => Effect.Effect<void, ForgeSessionRepositoryError>;
  readonly getChunks: (
    sessionId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeChunk>, ForgeSessionRepositoryError>;
  readonly replaceTopicsForSession: (
    sessionId: number,
    writes: ReadonlyArray<ForgeTopicWrite>,
  ) => Effect.Effect<void, ForgeSessionRepositoryError>;
  readonly replaceTopicsForChunk: (input: {
    readonly sessionId: number;
    readonly sequenceOrder: number;
    readonly topics: ReadonlyArray<string>;
  }) => Effect.Effect<void, ForgeSessionRepositoryError>;
  readonly getTopicsBySession: (
    sessionId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeChunkTopics>, ForgeSessionRepositoryError>;
  readonly getTopicByRef: (
    input: ForgeTopicRef,
  ) => Effect.Effect<ForgeTopicRecord | null, ForgeSessionRepositoryError>;
  readonly getCardsSnapshotBySession: (
    sessionId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeTopicCardsSnapshotRow>, ForgeSessionRepositoryError>;
  readonly getCardsForTopicRef: (
    input: ForgeTopicRef,
  ) => Effect.Effect<ForgeTopicCardsResultRow | null, ForgeSessionRepositoryError>;
  readonly tryStartTopicGeneration: (
    topicId: number,
  ) => Effect.Effect<
    ForgeTopicGenerationRow,
    ForgeSessionRepositoryError | ForgeTopicAlreadyGeneratingRepositoryError
  >;
  readonly finishTopicGenerationError: (input: {
    readonly topicId: number;
    readonly message: string;
  }) => Effect.Effect<ForgeTopicGenerationRow, ForgeSessionRepositoryError>;
  readonly replaceCardsForTopic: (input: {
    readonly topicId: number;
    readonly cards: ReadonlyArray<{ readonly question: string; readonly answer: string }>;
  }) => Effect.Effect<void, ForgeSessionRepositoryError>;
  readonly replaceCardsForTopicAndFinishGenerationSuccess: (input: {
    readonly topicId: number;
    readonly cards: ReadonlyArray<{ readonly question: string; readonly answer: string }>;
  }) => Effect.Effect<ForgeTopicGenerationRow, ForgeSessionRepositoryError>;
  readonly updateCardContent: (input: {
    readonly cardId: number;
    readonly question: string;
    readonly answer: string;
  }) => Effect.Effect<ForgeGeneratedCard | null, ForgeSessionRepositoryError>;
  readonly getCardById: (
    cardId: number,
  ) => Effect.Effect<ForgeCardWithTopicContext | null, ForgeSessionRepositoryError>;
  readonly replacePermutationsForCard: (input: {
    readonly sourceCardId: number;
    readonly permutations: ReadonlyArray<{ readonly question: string; readonly answer: string }>;
  }) => Effect.Effect<void, ForgeSessionRepositoryError>;
  readonly getPermutationsForCard: (
    sourceCardId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeCardPermutation>, ForgeSessionRepositoryError>;
  readonly upsertClozeForCard: (input: {
    readonly sourceCardId: number;
    readonly clozeText: string;
  }) => Effect.Effect<ForgeCardCloze, ForgeSessionRepositoryError>;
  readonly getClozeForCard: (
    sourceCardId: number,
  ) => Effect.Effect<ForgeCardCloze | null, ForgeSessionRepositoryError>;
  readonly recoverStaleGeneratingTopics: (input: {
    readonly sessionId: number;
    readonly staleBeforeIso: string;
    readonly message: string;
  }) => Effect.Effect<number, ForgeSessionRepositoryError>;
  readonly getChunkCount: (sessionId: number) => Effect.Effect<number, ForgeSessionRepositoryError>;
}

type ForgeSessionRow = {
  id: number;
  source_kind: ForgeSourceKind;
  source_file_path: string;
  deck_path: string | null;
  source_fingerprint: string;
  status: ForgeSessionStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type ForgeChunkRow = {
  id: number;
  session_id: number;
  text: string;
  sequence_order: number;
  page_boundaries: string;
  created_at: string;
};

type ForgeChunkReferenceRow = {
  id: number;
  sequence_order: number;
};

type ForgeTopicRow = {
  chunk_id: number;
  sequence_order: number;
  topic_order: number | null;
  topic_text: string | null;
};

type ForgeTopicRecordRow = {
  topic_id: number;
  session_id: number;
  chunk_id: number;
  sequence_order: number;
  topic_index: number;
  topic_text: string;
  chunk_text: string;
};

type ForgeTopicGenerationRowDb = {
  topic_id: number;
  status: ForgeTopicCardsStatus;
  error_message: string | null;
  generation_started_at: string | null;
  status_changed_at: string;
  generation_revision: number;
};

type ForgeTopicCardsSnapshotRowDb = {
  topic_id: number;
  chunk_id: number;
  sequence_order: number;
  topic_index: number;
  topic_text: string;
  status: ForgeTopicCardsStatus;
  error_message: string | null;
  card_count: number;
  generation_revision: number;
};

type ForgeCardRow = {
  id: number;
  topic_id: number;
  card_order: number;
  question: string;
  answer: string;
};

type ForgeCardWithTopicContextRow = {
  id: number;
  topic_id: number;
  card_order: number;
  question: string;
  answer: string;
  session_id: number;
  chunk_id: number;
  sequence_order: number;
  topic_index: number;
  topic_text: string;
  chunk_text: string;
};

type ForgeCardPermutationRow = {
  id: number;
  source_card_id: number;
  permutation_order: number;
  question: string;
  answer: string;
};

type ForgeCardClozeRow = {
  source_card_id: number;
  cloze_text: string;
};

type CountRow = {
  count: number;
};

const fromRow = (row: ForgeSessionRow): ForgeSession => ({
  id: Number(row.id),
  sourceKind: row.source_kind,
  sourceFilePath: row.source_file_path,
  deckPath: row.deck_path,
  sourceFingerprint: row.source_fingerprint,
  status: row.status,
  errorMessage: row.error_message,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const cloneSession = (session: ForgeSession): ForgeSession => ({ ...session });

const toTopicGenerationRow = (row: ForgeTopicGenerationRowDb): ForgeTopicGenerationRow => ({
  topicId: Number(row.topic_id),
  status: row.status,
  errorMessage: row.error_message,
  generationStartedAt: row.generation_started_at,
  statusChangedAt: row.status_changed_at,
  generationRevision: Number(row.generation_revision),
});

const toTopicCardsSnapshotRow = (
  row: ForgeTopicCardsSnapshotRowDb,
): ForgeTopicCardsSnapshotRow => ({
  topicId: Number(row.topic_id),
  chunkId: Number(row.chunk_id),
  sequenceOrder: Number(row.sequence_order),
  topicIndex: Number(row.topic_index),
  topicText: row.topic_text,
  status: row.status,
  errorMessage: row.error_message,
  cardCount: Number(row.card_count),
  generationRevision: Number(row.generation_revision),
});

const toGeneratedCard = (row: ForgeCardRow): ForgeGeneratedCard => ({
  id: Number(row.id),
  topicId: Number(row.topic_id),
  cardOrder: Number(row.card_order),
  question: row.question,
  answer: row.answer,
});

const toCardPermutation = (row: ForgeCardPermutationRow): ForgeCardPermutation => ({
  id: Number(row.id),
  sourceCardId: Number(row.source_card_id),
  permutationOrder: Number(row.permutation_order),
  question: row.question,
  answer: row.answer,
});

const ALLOWED_TRANSITIONS: Record<ForgeSessionStatus, ReadonlySet<ForgeSessionStatus>> = {
  created: new Set(["extracting", "error"]),
  extracting: new Set(["extracted", "error"]),
  extracted: new Set(["topics_extracting", "error"]),
  topics_extracting: new Set(["topics_extracted", "error"]),
  topics_extracted: new Set(["generating", "error"]),
  generating: new Set(["ready", "error"]),
  ready: new Set(["generating", "error"]),
  error: new Set(["error"]),
};

const canTransitionStatus = (
  fromStatus: ForgeSessionStatus,
  toStatus: ForgeSessionStatus,
): boolean => fromStatus === toStatus || ALLOWED_TRANSITIONS[fromStatus].has(toStatus);

const TOPIC_GENERATION_ALLOWED_TRANSITIONS: Record<ForgeTopicCardsStatus, ReadonlySet<ForgeTopicCardsStatus>> = {
  idle: new Set(["generating"]),
  generating: new Set(["generated", "error"]),
  generated: new Set(["generating", "generated"]),
  error: new Set(["generating", "error"]),
};

const canTransitionTopicGenerationStatus = (
  fromStatus: ForgeTopicCardsStatus,
  toStatus: ForgeTopicCardsStatus,
): boolean =>
  fromStatus === toStatus || TOPIC_GENERATION_ALLOWED_TRANSITIONS[fromStatus].has(toStatus);

const toPageBoundariesJson = (boundaries: ReadonlyArray<ForgeChunkPageBoundary>): string =>
  JSON.stringify(
    boundaries.map((boundary) => ({
      offset: boundary.offset,
      page: boundary.page,
    })),
  );

const cloneBoundaries = (
  boundaries: ReadonlyArray<ForgeChunkPageBoundary>,
): ReadonlyArray<ForgeChunkPageBoundary> => boundaries.map((boundary) => ({ ...boundary }));

const parsePageBoundaries = (
  raw: string,
): Effect.Effect<ReadonlyArray<ForgeChunkPageBoundary>, ForgeSessionRepositoryError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: (error) =>
        new ForgeSessionRepositoryError({
          operation: "getChunks.parsePageBoundaries",
          message: toErrorMessage(error),
        }),
    });

    return yield* Schema.decodeUnknown(Schema.Array(ForgeChunkPageBoundarySchema))(parsed).pipe(
      Effect.mapError(
        (error) =>
          new ForgeSessionRepositoryError({
            operation: "getChunks.validatePageBoundaries",
            message: toErrorMessage(error),
          }),
      ),
    );
  });

const toForgeChunk = (row: ForgeChunkRow): Effect.Effect<ForgeChunk, ForgeSessionRepositoryError> =>
  parsePageBoundaries(row.page_boundaries).pipe(
    Effect.map((pageBoundaries) => ({
      id: Number(row.id),
      sessionId: Number(row.session_id),
      text: row.text,
      sequenceOrder: Number(row.sequence_order),
      pageBoundaries,
      createdAt: row.created_at,
    })),
  );

export const makeSqliteForgeSessionRepository = ({
  runtime,
}: {
  readonly runtime: ManagedRuntime.ManagedRuntime<
    SqlClient.SqlClient | SqliteClient.SqliteClient,
    unknown
  >;
}): ForgeSessionRepository => {
  const runSql = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E, SqlClient.SqlClient>,
  ): Effect.Effect<A, E | ForgeSessionRepositoryError> =>
    runSqlInRuntimeOrMapRuntimeError({
      runtime,
      effect,
      mapRuntimeError: (error) =>
        new ForgeSessionRepositoryError({
          operation,
          message: toErrorMessage(error),
        }),
    });

  const withSqlError = <A>(
    operation: string,
    effect: Effect.Effect<A, unknown, SqlClient.SqlClient>,
  ): Effect.Effect<A, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    effect.pipe(
      Effect.mapError(
        (error) =>
          new ForgeSessionRepositoryError({
            operation,
            message: toErrorMessage(error),
          }),
      ),
    );

  const loadSessionByIdSql = (
    sessionId: number,
  ): Effect.Effect<ForgeSession | null, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getSessionById.select",
        sql<ForgeSessionRow>`
          SELECT
            id,
            source_kind,
            source_file_path,
            deck_path,
            source_fingerprint,
            status,
            error_message,
            created_at,
            updated_at
          FROM forge_sessions
          WHERE id = ${sessionId}
          LIMIT 1
        `,
      );

      const row = rows[0];
      return row ? fromRow(row) : null;
    });

  const loadChunksBySessionSql = (
    sessionId: number,
  ): Effect.Effect<ReadonlyArray<ForgeChunk>, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getChunks.select",
        sql<ForgeChunkRow>`
          SELECT
            id,
            session_id,
            text,
            sequence_order,
            page_boundaries,
            created_at
          FROM forge_chunks
          WHERE session_id = ${sessionId}
          ORDER BY sequence_order ASC, id ASC
        `,
      );

      return yield* Effect.forEach(rows, toForgeChunk, { concurrency: 1 });
    });

  const loadTopicByRefSql = (
    input: ForgeTopicRef,
  ): Effect.Effect<ForgeTopicRecord | null, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getTopicByRef.select",
        sql<ForgeTopicRecordRow>`
          SELECT
            forge_topics.id AS topic_id,
            forge_chunks.session_id AS session_id,
            forge_chunks.id AS chunk_id,
            forge_chunks.sequence_order AS sequence_order,
            forge_topics.topic_order AS topic_index,
            forge_topics.topic_text AS topic_text,
            forge_chunks.text AS chunk_text
          FROM forge_topics
          JOIN forge_chunks ON forge_chunks.id = forge_topics.chunk_id
          WHERE forge_chunks.session_id = ${input.sessionId}
            AND forge_chunks.id = ${input.chunkId}
            AND forge_topics.topic_order = ${input.topicIndex}
          LIMIT 1
        `,
      );

      const row = rows[0];
      if (!row) return null;

      return {
        topicId: Number(row.topic_id),
        sessionId: Number(row.session_id),
        chunkId: Number(row.chunk_id),
        sequenceOrder: Number(row.sequence_order),
        topicIndex: Number(row.topic_index),
        topicText: row.topic_text,
        chunkText: row.chunk_text,
      };
    });

  const loadCardsSnapshotRowsSql = (input: {
    readonly operation: string;
    readonly sessionId: number | null;
    readonly topicId: number | null;
  }): Effect.Effect<
    ReadonlyArray<ForgeTopicCardsSnapshotRow>,
    ForgeSessionRepositoryError,
    SqlClient.SqlClient
  > =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        input.operation,
        sql<ForgeTopicCardsSnapshotRowDb>`
          SELECT
            forge_topics.id AS topic_id,
            forge_chunks.id AS chunk_id,
            forge_chunks.sequence_order AS sequence_order,
            forge_topics.topic_order AS topic_index,
            forge_topics.topic_text AS topic_text,
            COALESCE(forge_topic_generation.status, 'idle') AS status,
            forge_topic_generation.error_message AS error_message,
            COALESCE(COUNT(forge_cards.id), 0) AS card_count,
            COALESCE(forge_topic_generation.generation_revision, 0) AS generation_revision
          FROM forge_topics
          JOIN forge_chunks ON forge_chunks.id = forge_topics.chunk_id
          LEFT JOIN forge_topic_generation ON forge_topic_generation.topic_id = forge_topics.id
          LEFT JOIN forge_cards ON forge_cards.topic_id = forge_topics.id
          WHERE (${input.sessionId} IS NULL OR forge_chunks.session_id = ${input.sessionId})
            AND (${input.topicId} IS NULL OR forge_topics.id = ${input.topicId})
          GROUP BY
            forge_topics.id,
            forge_chunks.id,
            forge_chunks.sequence_order,
            forge_topics.topic_order,
            forge_topics.topic_text,
            forge_topic_generation.status,
            forge_topic_generation.error_message,
            forge_topic_generation.generation_revision
          ORDER BY forge_chunks.sequence_order ASC, forge_topics.topic_order ASC, forge_topics.id ASC
        `,
      );

      return rows.map(toTopicCardsSnapshotRow);
    });

  const loadCardsSnapshotBySessionSql = (
    sessionId: number,
  ): Effect.Effect<
    ReadonlyArray<ForgeTopicCardsSnapshotRow>,
    ForgeSessionRepositoryError,
    SqlClient.SqlClient
  > =>
    loadCardsSnapshotRowsSql({
      operation: "getCardsSnapshotBySession.select",
      sessionId,
      topicId: null,
    });

  const loadCardsSnapshotByTopicIdSql = (
    topicId: number,
  ): Effect.Effect<ForgeTopicCardsSnapshotRow | null, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    loadCardsSnapshotRowsSql({
      operation: "getCardsSnapshotByTopicId.select",
      sessionId: null,
      topicId,
    }).pipe(Effect.map((rows) => rows[0] ?? null));

  const loadCardsForTopicIdSql = (
    topicId: number,
  ): Effect.Effect<ReadonlyArray<ForgeGeneratedCard>, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getCardsForTopic.select",
        sql<ForgeCardRow>`
          SELECT id, topic_id, card_order, question, answer
          FROM forge_cards
          WHERE topic_id = ${topicId}
          ORDER BY card_order ASC, id ASC
        `,
      );

      return rows.map(toGeneratedCard);
    });

  const loadTopicGenerationByTopicIdSql = (
    topicId: number,
  ): Effect.Effect<ForgeTopicGenerationRow | null, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getTopicGenerationByTopicId.select",
        sql<ForgeTopicGenerationRowDb>`
          SELECT
            topic_id,
            status,
            error_message,
            generation_started_at,
            status_changed_at,
            generation_revision
          FROM forge_topic_generation
          WHERE topic_id = ${topicId}
          LIMIT 1
        `,
      );

      const row = rows[0];
      return row ? toTopicGenerationRow(row) : null;
    });

  const loadCardByIdWithContextSql = (
    cardId: number,
  ): Effect.Effect<ForgeCardWithTopicContext | null, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getCardById.select",
        sql<ForgeCardWithTopicContextRow>`
          SELECT
            forge_cards.id AS id,
            forge_cards.topic_id AS topic_id,
            forge_cards.card_order AS card_order,
            forge_cards.question AS question,
            forge_cards.answer AS answer,
            forge_chunks.session_id AS session_id,
            forge_chunks.id AS chunk_id,
            forge_chunks.sequence_order AS sequence_order,
            forge_topics.topic_order AS topic_index,
            forge_topics.topic_text AS topic_text,
            forge_chunks.text AS chunk_text
          FROM forge_cards
          JOIN forge_topics ON forge_topics.id = forge_cards.topic_id
          JOIN forge_chunks ON forge_chunks.id = forge_topics.chunk_id
          WHERE forge_cards.id = ${cardId}
          LIMIT 1
        `,
      );

      const row = rows[0];
      if (!row) return null;

      return {
        id: Number(row.id),
        topicId: Number(row.topic_id),
        cardOrder: Number(row.card_order),
        question: row.question,
        answer: row.answer,
        sessionId: Number(row.session_id),
        chunkId: Number(row.chunk_id),
        sequenceOrder: Number(row.sequence_order),
        topicIndex: Number(row.topic_index),
        topicText: row.topic_text,
        chunkText: row.chunk_text,
      };
    });

  const loadPermutationsBySourceCardIdSql = (
    sourceCardId: number,
  ): Effect.Effect<
    ReadonlyArray<ForgeCardPermutation>,
    ForgeSessionRepositoryError,
    SqlClient.SqlClient
  > =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getPermutationsForCard.select",
        sql<ForgeCardPermutationRow>`
          SELECT id, source_card_id, permutation_order, question, answer
          FROM forge_card_permutations
          WHERE source_card_id = ${sourceCardId}
          ORDER BY permutation_order ASC, id ASC
        `,
      );

      return rows.map(toCardPermutation);
    });

  const loadClozeBySourceCardIdSql = (
    sourceCardId: number,
  ): Effect.Effect<ForgeCardCloze | null, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      const rows = yield* withSqlError(
        "getClozeForCard.select",
        sql<ForgeCardClozeRow>`
          SELECT source_card_id, cloze_text
          FROM forge_card_cloze
          WHERE source_card_id = ${sourceCardId}
          LIMIT 1
        `,
      );

      const row = rows[0];
      if (!row) return null;
      return {
        sourceCardId: Number(row.source_card_id),
        clozeText: row.cloze_text,
      };
    });

  const replaceCardsForTopicSql = (input: {
    readonly topicId: number;
    readonly cards: ReadonlyArray<{ readonly question: string; readonly answer: string }>;
  }): Effect.Effect<void, ForgeSessionRepositoryError, SqlClient.SqlClient> =>
    Effect.gen(function* () {
      const sql = (yield* SqlClient.SqlClient).withoutTransforms();
      yield* withSqlError(
        "replaceCardsForTopic.delete",
        sql`
          DELETE FROM forge_cards
          WHERE topic_id = ${input.topicId}
        `,
      );

      yield* Effect.forEach(
        input.cards,
        (card, cardOrder) =>
          withSqlError(
            "replaceCardsForTopic.insert",
            sql`
              INSERT INTO forge_cards (
                topic_id,
                card_order,
                question,
                answer
              ) VALUES (
                ${input.topicId},
                ${cardOrder},
                ${card.question},
                ${card.answer}
              )
            `,
          ),
        { discard: true },
      );
    });

  return {
    createSession: (input) =>
      runSql(
        "createSession.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();

          yield* withSqlError(
            "createSession.insert",
            sql`
              INSERT INTO forge_sessions (
                source_kind,
                source_file_path,
                deck_path,
                source_fingerprint,
                status,
                error_message
              ) VALUES (
                ${input.sourceKind},
                ${input.sourceFilePath},
                ${input.deckPath},
                ${input.sourceFingerprint},
                'created',
                null
              )
            `,
          );

          const idRows = yield* withSqlError(
            "createSession.lastInsertId",
            sql<{ id: number }>`
              SELECT last_insert_rowid() AS id
            `,
          );

          const sessionId = Number(idRows[0]?.id);
          if (!Number.isInteger(sessionId) || sessionId <= 0) {
            return yield* Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "createSession.lastInsertId",
                message: "Could not resolve inserted Forge session id.",
              }),
            );
          }

          const created = yield* loadSessionByIdSql(sessionId);
          if (!created) {
            return yield* Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "createSession.readBack",
                message: "Inserted Forge session could not be read back.",
              }),
            );
          }

          return created;
        }),
      ),
    findLatestBySourceFingerprint: ({ sourceKind, sourceFingerprint }) =>
      runSql(
        "findLatestBySourceFingerprint.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "findLatestBySourceFingerprint.select",
            sql<ForgeSessionRow>`
              SELECT
                id,
                source_kind,
                source_file_path,
                deck_path,
                source_fingerprint,
                status,
                error_message,
                created_at,
                updated_at
              FROM forge_sessions
              WHERE source_kind = ${sourceKind}
                AND source_fingerprint = ${sourceFingerprint}
              ORDER BY created_at DESC, id DESC
              LIMIT 1
            `,
          );

          const row = rows[0];
          return row ? fromRow(row) : null;
        }),
      ),
    findLatestBySourceFilePath: ({ sourceKind, sourceFilePath }) =>
      runSql(
        "findLatestBySourceFilePath.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "findLatestBySourceFilePath.select",
            sql<ForgeSessionRow>`
              SELECT
                id,
                source_kind,
                source_file_path,
                deck_path,
                source_fingerprint,
                status,
                error_message,
                created_at,
                updated_at
              FROM forge_sessions
              WHERE source_kind = ${sourceKind}
                AND source_file_path = ${sourceFilePath}
              ORDER BY created_at DESC, id DESC
              LIMIT 1
            `,
          );

          const row = rows[0];
          return row ? fromRow(row) : null;
        }),
      ),
    getSession: (sessionId) => runSql("getSession.runtime", loadSessionByIdSql(sessionId)),
    tryBeginExtraction: (sessionId) =>
      runSql(
        "tryBeginExtraction.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "tryBeginExtraction.update",
            sql<ForgeSessionRow>`
              UPDATE forge_sessions
              SET
                status = 'extracting',
                error_message = null,
                updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              WHERE id = ${sessionId}
                AND status = 'created'
              RETURNING
                id,
                source_kind,
                source_file_path,
                deck_path,
                source_fingerprint,
                status,
                error_message,
                created_at,
                updated_at
            `,
          );

          const row = rows[0];
          return row ? fromRow(row) : null;
        }),
      ),
    setSessionStatus: ({ sessionId, status, errorMessage }) =>
      runSql(
        "setSessionStatus.runtime",
        Effect.gen(function* () {
          const existing = yield* loadSessionByIdSql(sessionId);
          if (!existing) {
            return null;
          }

          if (!canTransitionStatus(existing.status, status)) {
            return yield* Effect.fail(
              new ForgeSessionStatusTransitionError({
                sessionId,
                fromStatus: existing.status,
                toStatus: status,
              }),
            );
          }

          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "setSessionStatus.update",
            sql<ForgeSessionRow>`
              UPDATE forge_sessions
              SET
                status = ${status},
                error_message = ${errorMessage},
                updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              WHERE id = ${sessionId}
                AND status = ${existing.status}
              RETURNING
                id,
                source_kind,
                source_file_path,
                deck_path,
                source_fingerprint,
                status,
                error_message,
                created_at,
                updated_at
            `,
          );

          const row = rows[0];
          if (!row) {
            const latest = yield* loadSessionByIdSql(sessionId);
            if (!latest) return null;

            return yield* Effect.fail(
              new ForgeSessionStatusTransitionError({
                sessionId,
                fromStatus: latest.status,
                toStatus: status,
              }),
            );
          }

          return fromRow(row);
        }),
      ),
    hasChunks: (sessionId) =>
      runSql(
        "hasChunks.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "hasChunks.select",
            sql<{ present: number }>`
              SELECT 1 AS present
              FROM forge_chunks
              WHERE session_id = ${sessionId}
              LIMIT 1
            `,
          );

          return rows.length > 0;
        }),
      ),
    getChunks: (sessionId) => runSql("getChunks.runtime", loadChunksBySessionSql(sessionId)),
    saveChunks: (sessionId, chunks) =>
      runSql(
        "saveChunks.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();

          const insertEffect = Effect.forEach(
            chunks,
            (chunk) =>
              sql`
                INSERT INTO forge_chunks (
                  session_id,
                  text,
                  sequence_order,
                  page_boundaries
                ) VALUES (
                  ${sessionId},
                  ${chunk.text},
                  ${chunk.sequenceOrder},
                  ${toPageBoundariesJson(chunk.pageBoundaries)}
                )
              `,
            { discard: true },
          );

          yield* sql.withTransaction(insertEffect).pipe(
            Effect.mapError(
              (error) =>
                new ForgeSessionRepositoryError({
                  operation: "saveChunks.transaction",
                  message: toErrorMessage(error),
                }),
            ),
          );
        }),
      ),
    replaceTopicsForSession: (sessionId, writes) =>
      runSql(
        "replaceTopicsForSession.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const replaceEffect = Effect.gen(function* () {
            const chunkRows = yield* withSqlError(
              "replaceTopicsForSession.selectChunks",
              sql<ForgeChunkReferenceRow>`
                SELECT id, sequence_order
                FROM forge_chunks
                WHERE session_id = ${sessionId}
              `,
            );

            const chunkIdBySequence = new Map<number, number>();
            for (const row of chunkRows) {
              chunkIdBySequence.set(Number(row.sequence_order), Number(row.id));
            }

            const seenWriteSequences = new Set<number>();
            const stagedTopicRows: Array<{
              readonly chunkId: number;
              readonly topicOrder: number;
              readonly topicText: string;
            }> = [];

            for (const write of writes) {
              if (seenWriteSequences.has(write.sequenceOrder)) {
                return yield* Effect.fail(
                  new ForgeSessionRepositoryError({
                    operation: "replaceTopicsForSession.validateWrites",
                    message: `Duplicate topic write for sequence order ${write.sequenceOrder} in session ${sessionId}.`,
                  }),
                );
              }

              seenWriteSequences.add(write.sequenceOrder);

              const chunkId = chunkIdBySequence.get(write.sequenceOrder);
              if (chunkId === undefined) {
                return yield* Effect.fail(
                  new ForgeSessionRepositoryError({
                    operation: "replaceTopicsForSession.validateWrites",
                    message: `Chunk sequence order ${write.sequenceOrder} was not found for session ${sessionId}.`,
                  }),
                );
              }

              for (let index = 0; index < write.topics.length; index += 1) {
                stagedTopicRows.push({
                  chunkId,
                  topicOrder: index,
                  topicText: write.topics[index]!,
                });
              }
            }

            yield* sql`
              DELETE FROM forge_topics
              WHERE chunk_id IN (
                SELECT id
                FROM forge_chunks
                WHERE session_id = ${sessionId}
              )
            `;

            yield* Effect.forEach(
              stagedTopicRows,
              (row) =>
                sql`
                  INSERT INTO forge_topics (
                    chunk_id,
                    topic_order,
                    topic_text
                  ) VALUES (
                    ${row.chunkId},
                    ${row.topicOrder},
                    ${row.topicText}
                  )
                `,
              { discard: true },
            );
          });

          yield* sql.withTransaction(replaceEffect).pipe(
            Effect.mapError(
              (error) =>
                new ForgeSessionRepositoryError({
                  operation: "replaceTopicsForSession.transaction",
                  message: toErrorMessage(error),
                }),
            ),
          );
        }),
      ),
    replaceTopicsForChunk: ({ sessionId, sequenceOrder, topics }) =>
      runSql(
        "replaceTopicsForChunk.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const replaceEffect = Effect.gen(function* () {
            const chunkRows = yield* withSqlError(
              "replaceTopicsForChunk.selectChunk",
              sql<ForgeChunkReferenceRow>`
                SELECT id, sequence_order
                FROM forge_chunks
                WHERE session_id = ${sessionId}
                  AND sequence_order = ${sequenceOrder}
                LIMIT 1
              `,
            );

            const chunk = chunkRows[0];
            if (!chunk) {
              return yield* Effect.fail(
                new ForgeSessionRepositoryError({
                  operation: "replaceTopicsForChunk.selectChunk",
                  message: `Chunk sequence order ${sequenceOrder} was not found for session ${sessionId}.`,
                }),
              );
            }

            const chunkId = Number(chunk.id);

            yield* sql`
              DELETE FROM forge_topics
              WHERE chunk_id = ${chunkId}
            `;

            yield* Effect.forEach(
              topics,
              (topicText, topicOrder) =>
                sql`
                  INSERT INTO forge_topics (
                    chunk_id,
                    topic_order,
                    topic_text
                  ) VALUES (
                    ${chunkId},
                    ${topicOrder},
                    ${topicText}
                  )
                `,
              { discard: true },
            );
          });

          yield* sql.withTransaction(replaceEffect).pipe(
            Effect.mapError(
              (error) =>
                new ForgeSessionRepositoryError({
                  operation: "replaceTopicsForChunk.transaction",
                  message: toErrorMessage(error),
                }),
            ),
          );
        }),
      ),
    getTopicsBySession: (sessionId) =>
      runSql(
        "getTopicsBySession.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "getTopicsBySession.select",
            sql<ForgeTopicRow>`
              SELECT
                forge_chunks.id AS chunk_id,
                forge_chunks.sequence_order AS sequence_order,
                forge_topics.topic_order AS topic_order,
                forge_topics.topic_text AS topic_text
              FROM forge_chunks
              LEFT JOIN forge_topics ON forge_topics.chunk_id = forge_chunks.id
              WHERE forge_chunks.session_id = ${sessionId}
              ORDER BY
                forge_chunks.sequence_order ASC,
                forge_topics.topic_order ASC,
                forge_topics.id ASC
            `,
          );

          const grouped: Array<{
            readonly chunkId: number;
            readonly sequenceOrder: number;
            readonly topics: Array<string>;
          }> = [];
          const byChunkId = new Map<number, (typeof grouped)[number]>();

          for (const row of rows) {
            const chunkId = Number(row.chunk_id);
            const sequenceOrder = Number(row.sequence_order);
            const topicText = row.topic_text;

            let chunk = byChunkId.get(chunkId);
            if (!chunk) {
              chunk = {
                chunkId,
                sequenceOrder,
                topics: [],
              };
              byChunkId.set(chunkId, chunk);
              grouped.push(chunk);
            }

            if (topicText !== null) {
              chunk.topics.push(topicText);
            }
          }

          return grouped.map((chunk) => ({
            chunkId: chunk.chunkId,
            sequenceOrder: chunk.sequenceOrder,
            topics: chunk.topics.slice(),
          }));
        }),
      ),
    getTopicByRef: (input) =>
      runSql("getTopicByRef.runtime", loadTopicByRefSql(input)),
    getCardsSnapshotBySession: (sessionId) =>
      runSql("getCardsSnapshotBySession.runtime", loadCardsSnapshotBySessionSql(sessionId)),
    getCardsForTopicRef: (input) =>
      runSql(
        "getCardsForTopicRef.runtime",
        Effect.gen(function* () {
          const topicRecord = yield* loadTopicByRefSql(input);
          if (!topicRecord) return null;

          const snapshotRow = yield* loadCardsSnapshotByTopicIdSql(topicRecord.topicId);
          if (!snapshotRow) {
            return yield* Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "getCardsForTopicRef.snapshotMissing",
                message: `Topic ${topicRecord.topicId} was not found in cards snapshot for session ${topicRecord.sessionId}.`,
              }),
            );
          }

          const cards = yield* loadCardsForTopicIdSql(topicRecord.topicId);
          return {
            topic: snapshotRow,
            cards,
          };
        }),
      ),
    tryStartTopicGeneration: (topicId) =>
      runSql(
        "tryStartTopicGeneration.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();

          const rows = yield* withSqlError(
            "tryStartTopicGeneration.upsert",
            sql<ForgeTopicGenerationRowDb>`
              INSERT INTO forge_topic_generation (
                topic_id,
                status,
                error_message,
                generation_started_at,
                status_changed_at,
                generation_revision
              ) VALUES (
                ${topicId},
                'generating',
                null,
                (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                0
              )
              ON CONFLICT(topic_id) DO UPDATE SET
                status = 'generating',
                error_message = null,
                generation_started_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                status_changed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              WHERE forge_topic_generation.status <> 'generating'
              RETURNING
                topic_id,
                status,
                error_message,
                generation_started_at,
                status_changed_at,
                generation_revision
            `,
          );

          const row = rows[0];
          if (row) {
            return toTopicGenerationRow(row);
          }

          const existing = yield* loadTopicGenerationByTopicIdSql(topicId);
          if (existing?.status === "generating") {
            return yield* Effect.fail(
              new ForgeTopicAlreadyGeneratingRepositoryError({
                topicId,
              }),
            );
          }

          return yield* Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "tryStartTopicGeneration.upsert",
              message: `Could not transition topic ${topicId} to generating.`,
            }),
          );
        }),
      ),
    finishTopicGenerationError: ({ topicId, message }) =>
      runSql(
        "finishTopicGenerationError.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          yield* withSqlError(
            "finishTopicGenerationError.insert",
            sql`
              INSERT INTO forge_topic_generation (
                topic_id,
                status,
                error_message,
                generation_started_at,
                status_changed_at,
                generation_revision
              ) VALUES (
                ${topicId},
                'error',
                ${message},
                null,
                (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                0
              )
              ON CONFLICT(topic_id) DO NOTHING
            `,
          );

          const rows = yield* withSqlError(
            "finishTopicGenerationError.update",
            sql<ForgeTopicGenerationRowDb>`
              UPDATE forge_topic_generation
              SET
                status = 'error',
                error_message = ${message},
                generation_started_at = null,
                status_changed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              WHERE topic_id = ${topicId}
                AND status = 'generating'
              RETURNING
                topic_id,
                status,
                error_message,
                generation_started_at,
                status_changed_at,
                generation_revision
            `,
          );

          const row = rows[0];
          if (row) return toTopicGenerationRow(row);

          const latest = yield* loadTopicGenerationByTopicIdSql(topicId);
          if (!latest) {
            return yield* Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "finishTopicGenerationError.update",
                message: `Could not find generation row for topic ${topicId}.`,
              }),
            );
          }

          return yield* Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "finishTopicGenerationError.update",
              message: `Could not update generation status to error for topic ${topicId} from status ${latest.status}.`,
            }),
          );
        }),
      ),
    replaceCardsForTopic: ({ topicId, cards }) =>
      runSql(
        "replaceCardsForTopic.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          yield* withSqlError(
            "replaceCardsForTopic.transaction",
            sql.withTransaction(replaceCardsForTopicSql({ topicId, cards })),
          );
        }),
      ),
    replaceCardsForTopicAndFinishGenerationSuccess: ({ topicId, cards }) =>
      runSql(
        "replaceCardsForTopicAndFinishGenerationSuccess.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const operation = Effect.gen(function* () {
            yield* replaceCardsForTopicSql({ topicId, cards });

            const rows = yield* sql<ForgeTopicGenerationRowDb>`
              UPDATE forge_topic_generation
              SET
                status = 'generated',
                error_message = null,
                generation_started_at = null,
                status_changed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                generation_revision = generation_revision + 1
              WHERE topic_id = ${topicId}
                AND status = 'generating'
              RETURNING
                topic_id,
                status,
                error_message,
                generation_started_at,
                status_changed_at,
                generation_revision
            `.pipe(
              Effect.mapError(
                (error) =>
                  new ForgeSessionRepositoryError({
                    operation: "replaceCardsForTopicAndFinishGenerationSuccess.update",
                    message: toErrorMessage(error),
                  }),
              ),
            );

            const row = rows[0];
            if (row) return toTopicGenerationRow(row);

            const latest = yield* loadTopicGenerationByTopicIdSql(topicId);
            if (!latest) {
              return yield* Effect.fail(
                new ForgeSessionRepositoryError({
                  operation: "replaceCardsForTopicAndFinishGenerationSuccess.update",
                  message: `Could not find generation row for topic ${topicId}.`,
                }),
              );
            }

            return yield* Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "replaceCardsForTopicAndFinishGenerationSuccess.update",
                message: `Could not update generation status to generated for topic ${topicId} from status ${latest.status}.`,
              }),
            );
          });

          return yield* withSqlError(
            "replaceCardsForTopicAndFinishGenerationSuccess.transaction",
            sql.withTransaction(operation),
          );
        }),
      ),
    updateCardContent: ({ cardId, question, answer }) =>
      runSql(
        "updateCardContent.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "updateCardContent.update",
            sql<ForgeCardRow>`
              UPDATE forge_cards
              SET
                question = ${question},
                answer = ${answer}
              WHERE id = ${cardId}
              RETURNING id, topic_id, card_order, question, answer
            `,
          );

          const row = rows[0];
          return row ? toGeneratedCard(row) : null;
        }),
      ),
    getCardById: (cardId) =>
      runSql("getCardById.runtime", loadCardByIdWithContextSql(cardId)),
    replacePermutationsForCard: ({ sourceCardId, permutations }) =>
      runSql(
        "replacePermutationsForCard.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const replaceEffect = Effect.gen(function* () {
            yield* sql`
              DELETE FROM forge_card_permutations
              WHERE source_card_id = ${sourceCardId}
            `;

            yield* Effect.forEach(
              permutations,
              (permutation, permutationOrder) =>
                sql`
                  INSERT INTO forge_card_permutations (
                    source_card_id,
                    permutation_order,
                    question,
                    answer
                  ) VALUES (
                    ${sourceCardId},
                    ${permutationOrder},
                    ${permutation.question},
                    ${permutation.answer}
                  )
                `,
              { discard: true },
            );
          });

          yield* sql.withTransaction(replaceEffect).pipe(
            Effect.mapError(
              (error) =>
                new ForgeSessionRepositoryError({
                  operation: "replacePermutationsForCard.transaction",
                  message: toErrorMessage(error),
                }),
            ),
          );
        }),
      ),
    getPermutationsForCard: (sourceCardId) =>
      runSql("getPermutationsForCard.runtime", loadPermutationsBySourceCardIdSql(sourceCardId)),
    upsertClozeForCard: ({ sourceCardId, clozeText }) =>
      runSql(
        "upsertClozeForCard.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          yield* withSqlError(
            "upsertClozeForCard.upsert",
            sql`
              INSERT INTO forge_card_cloze (
                source_card_id,
                cloze_text,
                created_at,
                updated_at
              ) VALUES (
                ${sourceCardId},
                ${clozeText},
                (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              )
              ON CONFLICT(source_card_id) DO UPDATE SET
                cloze_text = excluded.cloze_text,
                updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            `,
          );

          const cloze = yield* loadClozeBySourceCardIdSql(sourceCardId);
          if (cloze) return cloze;
          return yield* Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "upsertClozeForCard.readBack",
              message: `Could not read cloze row for source card ${sourceCardId}.`,
            }),
          );
        }),
      ),
    getClozeForCard: (sourceCardId) =>
      runSql("getClozeForCard.runtime", loadClozeBySourceCardIdSql(sourceCardId)),
    recoverStaleGeneratingTopics: ({ sessionId, staleBeforeIso, message }) =>
      runSql(
        "recoverStaleGeneratingTopics.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "recoverStaleGeneratingTopics.update",
            sql<CountRow>`
              UPDATE forge_topic_generation
              SET
                status = 'error',
                error_message = ${message},
                generation_started_at = null,
                status_changed_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
              WHERE status = 'generating'
                AND generation_started_at IS NOT NULL
                AND generation_started_at < ${staleBeforeIso}
                AND topic_id IN (
                  SELECT forge_topics.id
                  FROM forge_topics
                  JOIN forge_chunks ON forge_chunks.id = forge_topics.chunk_id
                  WHERE forge_chunks.session_id = ${sessionId}
                )
              RETURNING 1 AS count
            `,
          );

          return rows.length;
        }),
      ),
    getChunkCount: (sessionId) =>
      runSql(
        "getChunkCount.runtime",
        Effect.gen(function* () {
          const sql = (yield* SqlClient.SqlClient).withoutTransforms();
          const rows = yield* withSqlError(
            "getChunkCount.select",
            sql<{ count: number }>`
              SELECT COUNT(*) AS count
              FROM forge_chunks
              WHERE session_id = ${sessionId}
            `,
          );

          const count = Number(rows[0]?.count ?? 0);
          return Number.isFinite(count) && count >= 0 ? count : 0;
        }),
      ),
  };
};

type InMemoryChunk = {
  readonly id: number;
  readonly sessionId: number;
  readonly text: string;
  readonly sequenceOrder: number;
  readonly pageBoundaries: ReadonlyArray<ForgeChunkPageBoundary>;
  readonly createdAt: string;
};

type InMemoryTopic = {
  readonly id: number;
  readonly chunkId: number;
  readonly topicOrder: number;
  readonly topicText: string;
  readonly createdAt: string;
};

type InMemoryTopicGeneration = ForgeTopicGenerationRow;

type InMemoryCard = {
  readonly id: number;
  readonly topicId: number;
  readonly cardOrder: number;
  readonly question: string;
  readonly answer: string;
};

type InMemoryCardPermutation = ForgeCardPermutation;

type InMemoryCardCloze = ForgeCardCloze;

export const makeInMemoryForgeSessionRepository = (): ForgeSessionRepository => {
  let nextSessionId = 1;
  let nextChunkId = 1;
  let nextTopicId = 1;
  let nextCardId = 1;
  let nextPermutationId = 1;
  const sessions: ForgeSession[] = [];
  const chunks: InMemoryChunk[] = [];
  const topics: InMemoryTopic[] = [];
  const topicGeneration = new Map<number, InMemoryTopicGeneration>();
  const cards: InMemoryCard[] = [];
  const permutations: InMemoryCardPermutation[] = [];
  const clozeBySourceCardId = new Map<number, InMemoryCardCloze>();

  const nowIso = (): string => new Date().toISOString();

  const getTopicByRefInternal = (input: ForgeTopicRef): ForgeTopicRecord | null => {
    const ownerChunk = chunks.find(
      (chunk) => chunk.sessionId === input.sessionId && chunk.id === input.chunkId,
    );
    if (!ownerChunk) return null;

    const topic = topics.find(
      (entry) => entry.chunkId === ownerChunk.id && entry.topicOrder === input.topicIndex,
    );
    if (!topic) return null;

    return {
      topicId: topic.id,
      sessionId: input.sessionId,
      chunkId: ownerChunk.id,
      sequenceOrder: ownerChunk.sequenceOrder,
      topicIndex: topic.topicOrder,
      topicText: topic.topicText,
      chunkText: ownerChunk.text,
    };
  };

  const ensureTopicGenerationInternal = (topicId: number): InMemoryTopicGeneration => {
    const existing = topicGeneration.get(topicId);
    if (existing) return existing;

    const next: InMemoryTopicGeneration = {
      topicId,
      status: "idle",
      errorMessage: null,
      generationStartedAt: null,
      statusChangedAt: nowIso(),
      generationRevision: 0,
    };
    topicGeneration.set(topicId, next);
    return next;
  };

  const setTopicGenerationInternal = (next: InMemoryTopicGeneration): InMemoryTopicGeneration => {
    topicGeneration.set(next.topicId, next);
    return next;
  };

  const topicSnapshotBySessionInternal = (
    sessionId: number,
  ): ReadonlyArray<ForgeTopicCardsSnapshotRow> => {
    const chunkById = new Map<number, InMemoryChunk>();
    for (const chunk of chunks) {
      if (chunk.sessionId === sessionId) {
        chunkById.set(chunk.id, chunk);
      }
    }

    return topics
      .filter((topic) => chunkById.has(topic.chunkId))
      .sort((left, right) => {
        const leftChunk = chunkById.get(left.chunkId)!;
        const rightChunk = chunkById.get(right.chunkId)!;
        return (
          leftChunk.sequenceOrder - rightChunk.sequenceOrder ||
          left.topicOrder - right.topicOrder ||
          left.id - right.id
        );
      })
      .map((topic) => {
        const ownerChunk = chunkById.get(topic.chunkId)!;
        const generation = topicGeneration.get(topic.id);
        const cardCount = cards.filter((card) => card.topicId === topic.id).length;

        return {
          topicId: topic.id,
          chunkId: ownerChunk.id,
          sequenceOrder: ownerChunk.sequenceOrder,
          topicIndex: topic.topicOrder,
          topicText: topic.topicText,
          status: generation?.status ?? "idle",
          errorMessage: generation?.errorMessage ?? null,
          cardCount,
          generationRevision: generation?.generationRevision ?? 0,
        };
      });
  };

  const replaceCardsForTopicInternal = (
    topicId: number,
    nextCards: ReadonlyArray<{ readonly question: string; readonly answer: string }>,
  ): void => {
    const existingCardIds = new Set(
      cards.filter((card) => card.topicId === topicId).map((card) => card.id),
    );
    const retainedCards = cards.filter((card) => card.topicId !== topicId);
    const stagedCards = nextCards.map((card, cardOrder) => ({
      id: nextCardId + cardOrder,
      topicId,
      cardOrder,
      question: card.question,
      answer: card.answer,
    }));

    cards.length = 0;
    cards.push(...retainedCards, ...stagedCards);
    nextCardId += nextCards.length;

    if (existingCardIds.size > 0) {
      for (let index = permutations.length - 1; index >= 0; index -= 1) {
        const permutation = permutations[index];
        if (permutation && existingCardIds.has(permutation.sourceCardId)) {
          permutations.splice(index, 1);
        }
      }

      for (const cardId of existingCardIds) {
        clozeBySourceCardId.delete(cardId);
      }
    }
  };

  return {
    createSession: (input) =>
      Effect.sync(() => {
        const timestamp = nowIso();
        const session: ForgeSession = {
          id: nextSessionId,
          sourceKind: input.sourceKind,
          sourceFilePath: input.sourceFilePath,
          deckPath: input.deckPath,
          sourceFingerprint: input.sourceFingerprint,
          status: "created",
          errorMessage: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        nextSessionId += 1;
        sessions.push(session);

        return cloneSession(session);
      }),
    findLatestBySourceFingerprint: ({ sourceKind, sourceFingerprint }) =>
      Effect.sync(() => {
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          const session = sessions[index];
          if (!session) continue;

          if (
            session.sourceKind === sourceKind &&
            session.sourceFingerprint === sourceFingerprint
          ) {
            return cloneSession(session);
          }
        }

        return null;
      }),
    findLatestBySourceFilePath: ({ sourceKind, sourceFilePath }) =>
      Effect.sync(() => {
        for (let index = sessions.length - 1; index >= 0; index -= 1) {
          const session = sessions[index];
          if (!session) continue;

          if (session.sourceKind === sourceKind && session.sourceFilePath === sourceFilePath) {
            return cloneSession(session);
          }
        }

        return null;
      }),
    getSession: (sessionId) =>
      Effect.sync(() => {
        const session = sessions.find((entry) => entry.id === sessionId);
        return session ? cloneSession(session) : null;
      }),
    tryBeginExtraction: (sessionId) =>
      Effect.sync(() => {
        const index = sessions.findIndex((entry) => entry.id === sessionId);
        if (index < 0) {
          return null;
        }

        const existing = sessions[index]!;
        if (existing.status !== "created") {
          return null;
        }

        const next: ForgeSession = {
          ...existing,
          status: "extracting",
          errorMessage: null,
          updatedAt: nowIso(),
        };

        sessions[index] = next;
        return cloneSession(next);
      }),
    setSessionStatus: ({ sessionId, status, errorMessage }) =>
      Effect.suspend(() => {
        const index = sessions.findIndex((entry) => entry.id === sessionId);
        if (index < 0) return Effect.succeed(null);

        const existing = sessions[index]!;
        if (!canTransitionStatus(existing.status, status)) {
          return Effect.fail(
            new ForgeSessionStatusTransitionError({
              sessionId,
              fromStatus: existing.status,
              toStatus: status,
            }),
          );
        }

        const next: ForgeSession = {
          ...existing,
          status,
          errorMessage,
          updatedAt: nowIso(),
        };
        sessions[index] = next;

        return Effect.succeed(cloneSession(next));
      }),
    hasChunks: (sessionId) =>
      Effect.sync(() => chunks.some((entry) => entry.sessionId === sessionId)),
    getChunks: (sessionId) =>
      Effect.sync(() =>
        chunks
          .filter((entry) => entry.sessionId === sessionId)
          .sort((left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id)
          .map((entry) => ({
            id: entry.id,
            sessionId: entry.sessionId,
            text: entry.text,
            sequenceOrder: entry.sequenceOrder,
            pageBoundaries: cloneBoundaries(entry.pageBoundaries),
            createdAt: entry.createdAt,
          })),
      ),
    saveChunks: (sessionId, chunkRows) =>
      Effect.suspend(() => {
        const sessionExists = sessions.some((entry) => entry.id === sessionId);
        if (!sessionExists) {
          return Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "saveChunks.insert",
              message: `Forge session ${sessionId} does not exist.`,
            }),
          );
        }

        const existingSequences = new Set(
          chunks
            .filter((entry) => entry.sessionId === sessionId)
            .map((entry) => entry.sequenceOrder),
        );

        const batchSequences = new Set<number>();
        const stagedRows: InMemoryChunk[] = [];

        for (const row of chunkRows) {
          if (existingSequences.has(row.sequenceOrder) || batchSequences.has(row.sequenceOrder)) {
            return Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "saveChunks.insert",
                message: `Duplicate sequence order ${row.sequenceOrder} for session ${sessionId}.`,
              }),
            );
          }

          batchSequences.add(row.sequenceOrder);

          stagedRows.push({
            id: nextChunkId + stagedRows.length,
            sessionId,
            text: row.text,
            sequenceOrder: row.sequenceOrder,
            pageBoundaries: cloneBoundaries(row.pageBoundaries),
            createdAt: nowIso(),
          });
        }

        nextChunkId += stagedRows.length;
        chunks.push(...stagedRows);

        return Effect.void;
      }),
    replaceTopicsForSession: (sessionId, writes) =>
      Effect.suspend(() => {
        const chunkRows = chunks.filter((entry) => entry.sessionId === sessionId);
        const chunkIdBySequence = new Map<number, number>();
        for (const row of chunkRows) {
          chunkIdBySequence.set(row.sequenceOrder, row.id);
        }

        const seenWriteSequences = new Set<number>();
        const stagedTopics: InMemoryTopic[] = [];

        for (const write of writes) {
          if (seenWriteSequences.has(write.sequenceOrder)) {
            return Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "replaceTopicsForSession.validateWrites",
                message: `Duplicate topic write for sequence order ${write.sequenceOrder} in session ${sessionId}.`,
              }),
            );
          }
          seenWriteSequences.add(write.sequenceOrder);

          const chunkId = chunkIdBySequence.get(write.sequenceOrder);
          if (chunkId === undefined) {
            return Effect.fail(
              new ForgeSessionRepositoryError({
                operation: "replaceTopicsForSession.validateWrites",
                message: `Chunk sequence order ${write.sequenceOrder} was not found for session ${sessionId}.`,
              }),
            );
          }

          for (let index = 0; index < write.topics.length; index += 1) {
            stagedTopics.push({
              id: nextTopicId + stagedTopics.length,
              chunkId,
              topicOrder: index,
              topicText: write.topics[index]!,
              createdAt: nowIso(),
            });
          }
        }

        const sessionChunkIds = new Set(chunkRows.map((row) => row.id));
        const removedTopicIds = new Set(
          topics
            .filter((topic) => sessionChunkIds.has(topic.chunkId))
            .map((topic) => topic.id),
        );
        const retainedTopics = topics.filter((topic) => !sessionChunkIds.has(topic.chunkId));

        topics.length = 0;
        topics.push(...retainedTopics, ...stagedTopics);
        nextTopicId += stagedTopics.length;

        if (removedTopicIds.size > 0) {
          for (const topicId of removedTopicIds) {
            topicGeneration.delete(topicId);
          }

          const removedCardIds = new Set(
            cards.filter((card) => removedTopicIds.has(card.topicId)).map((card) => card.id),
          );
          cards.splice(
            0,
            cards.length,
            ...cards.filter((card) => !removedTopicIds.has(card.topicId)),
          );
          permutations.splice(
            0,
            permutations.length,
            ...permutations.filter((permutation) => !removedCardIds.has(permutation.sourceCardId)),
          );
          for (const cardId of removedCardIds) {
            clozeBySourceCardId.delete(cardId);
          }
        }

        return Effect.void;
      }),
    replaceTopicsForChunk: ({ sessionId, sequenceOrder, topics: topicTexts }) =>
      Effect.suspend(() => {
        const ownerChunk = chunks.find(
          (entry) => entry.sessionId === sessionId && entry.sequenceOrder === sequenceOrder,
        );

        if (!ownerChunk) {
          return Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "replaceTopicsForChunk.selectChunk",
              message: `Chunk sequence order ${sequenceOrder} was not found for session ${sessionId}.`,
            }),
          );
        }

        const retainedTopics = topics.filter((topic) => topic.chunkId !== ownerChunk.id);
        const removedTopicIds = new Set(
          topics.filter((topic) => topic.chunkId === ownerChunk.id).map((topic) => topic.id),
        );
        const stagedTopics = topicTexts.map((topicText, topicOrder) => ({
          id: nextTopicId + topicOrder,
          chunkId: ownerChunk.id,
          topicOrder,
          topicText,
          createdAt: nowIso(),
        }));

        topics.length = 0;
        topics.push(...retainedTopics, ...stagedTopics);
        nextTopicId += stagedTopics.length;

        if (removedTopicIds.size > 0) {
          for (const topicId of removedTopicIds) {
            topicGeneration.delete(topicId);
          }

          const removedCardIds = new Set(
            cards.filter((card) => removedTopicIds.has(card.topicId)).map((card) => card.id),
          );
          cards.splice(
            0,
            cards.length,
            ...cards.filter((card) => !removedTopicIds.has(card.topicId)),
          );
          permutations.splice(
            0,
            permutations.length,
            ...permutations.filter((permutation) => !removedCardIds.has(permutation.sourceCardId)),
          );
          for (const cardId of removedCardIds) {
            clozeBySourceCardId.delete(cardId);
          }
        }

        return Effect.void;
      }),
    getTopicsBySession: (sessionId) =>
      Effect.sync(() => {
        const chunkById = new Map<number, InMemoryChunk>();
        const orderedChunks: InMemoryChunk[] = [];
        for (const chunk of chunks) {
          if (chunk.sessionId === sessionId) {
            chunkById.set(chunk.id, chunk);
            orderedChunks.push(chunk);
          }
        }

        orderedChunks.sort(
          (left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id,
        );

        const grouped = new Map<
          number,
          {
            readonly chunkId: number;
            readonly sequenceOrder: number;
            readonly topics: Array<string>;
          }
        >();
        for (const chunk of orderedChunks) {
          grouped.set(chunk.id, {
            chunkId: chunk.id,
            sequenceOrder: chunk.sequenceOrder,
            topics: [],
          });
        }

        for (const topic of topics) {
          let group = grouped.get(topic.chunkId);
          if (!group) {
            const ownerChunk = chunkById.get(topic.chunkId);
            if (!ownerChunk) continue;
            group = {
              chunkId: ownerChunk.id,
              sequenceOrder: ownerChunk.sequenceOrder,
              topics: [],
            };
            grouped.set(topic.chunkId, group);
          }

          group.topics.push(topic.topicText);
        }

        return Array.from(grouped.values())
          .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
          .map((group) => ({
            chunkId: group.chunkId,
            sequenceOrder: group.sequenceOrder,
            topics: group.topics.slice(),
          }));
      }),
    getTopicByRef: (input) =>
      Effect.sync(() => {
        return getTopicByRefInternal(input);
      }),
    getCardsSnapshotBySession: (sessionId) =>
      Effect.sync(() => {
        return topicSnapshotBySessionInternal(sessionId);
      }),
    getCardsForTopicRef: (input) =>
      Effect.sync(() => {
        const topicRecord = getTopicByRefInternal(input);
        if (!topicRecord) return null;

        const topicSnapshot = topicSnapshotBySessionInternal(input.sessionId).find(
          (entry) => entry.topicId === topicRecord.topicId,
        );
        if (!topicSnapshot) return null;

        const topicCards = cards
          .filter((card) => card.topicId === topicRecord.topicId)
          .sort((left, right) => left.cardOrder - right.cardOrder || left.id - right.id)
          .map((card) => ({
            id: card.id,
            topicId: card.topicId,
            cardOrder: card.cardOrder,
            question: card.question,
            answer: card.answer,
          }));

        return {
          topic: topicSnapshot,
          cards: topicCards,
        };
      }),
    tryStartTopicGeneration: (
      topicId,
    ): Effect.Effect<
      ForgeTopicGenerationRow,
      ForgeSessionRepositoryError | ForgeTopicAlreadyGeneratingRepositoryError
    > =>
      Effect.suspend(
        (): Effect.Effect<
          ForgeTopicGenerationRow,
          ForgeSessionRepositoryError | ForgeTopicAlreadyGeneratingRepositoryError
        > => {
        const current = ensureTopicGenerationInternal(topicId);
        if (current.status === "generating") {
          return Effect.fail(
            new ForgeTopicAlreadyGeneratingRepositoryError({
              topicId,
            }),
          );
        }

        if (!canTransitionTopicGenerationStatus(current.status, "generating")) {
          return Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "tryStartTopicGeneration.transition",
              message: `Invalid topic generation transition for topic ${topicId}: ${current.status} -> generating.`,
            }),
          );
        }

        const next: InMemoryTopicGeneration = {
          ...current,
          status: "generating",
          errorMessage: null,
          generationStartedAt: nowIso(),
          statusChangedAt: nowIso(),
        };
        setTopicGenerationInternal(next);
        return Effect.succeed({ ...next });
        },
      ),
    finishTopicGenerationError: ({ topicId, message }) =>
      Effect.suspend(() => {
        const current = ensureTopicGenerationInternal(topicId);
        if (current.status !== "generating") {
          return Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "finishTopicGenerationError.transition",
              message: `Invalid topic generation transition for topic ${topicId}: ${current.status} -> error. Expected generating.`,
            }),
          );
        }

        const next: InMemoryTopicGeneration = {
          ...current,
          status: "error",
          errorMessage: message,
          generationStartedAt: null,
          statusChangedAt: nowIso(),
        };
        setTopicGenerationInternal(next);
        return Effect.succeed({ ...next });
      }),
    replaceCardsForTopic: ({ topicId, cards: nextCards }) =>
      Effect.sync(() => {
        replaceCardsForTopicInternal(topicId, nextCards);
      }),
    replaceCardsForTopicAndFinishGenerationSuccess: ({ topicId, cards: nextCards }) =>
      Effect.suspend(() => {
        const current = ensureTopicGenerationInternal(topicId);
        if (current.status !== "generating") {
          return Effect.fail(
            new ForgeSessionRepositoryError({
              operation: "replaceCardsForTopicAndFinishGenerationSuccess.transition",
              message: `Invalid topic generation transition for topic ${topicId}: ${current.status} -> generated. Expected generating.`,
            }),
          );
        }

        replaceCardsForTopicInternal(topicId, nextCards);

        const next: InMemoryTopicGeneration = {
          ...current,
          status: "generated",
          errorMessage: null,
          generationStartedAt: null,
          statusChangedAt: nowIso(),
          generationRevision: current.generationRevision + 1,
        };
        setTopicGenerationInternal(next);
        return Effect.succeed({ ...next });
      }),
    updateCardContent: ({ cardId, question, answer }) =>
      Effect.sync(() => {
        const index = cards.findIndex((card) => card.id === cardId);
        if (index < 0) return null;

        const current = cards[index]!;
        const next: InMemoryCard = {
          ...current,
          question,
          answer,
        };
        cards[index] = next;

        return {
          id: next.id,
          topicId: next.topicId,
          cardOrder: next.cardOrder,
          question: next.question,
          answer: next.answer,
        };
      }),
    getCardById: (cardId) =>
      Effect.sync(() => {
        const card = cards.find((entry) => entry.id === cardId);
        if (!card) return null;

        const topic = topics.find((entry) => entry.id === card.topicId);
        if (!topic) return null;

        const chunk = chunks.find((entry) => entry.id === topic.chunkId);
        if (!chunk) return null;

        return {
          id: card.id,
          topicId: card.topicId,
          cardOrder: card.cardOrder,
          question: card.question,
          answer: card.answer,
          sessionId: chunk.sessionId,
          chunkId: chunk.id,
          sequenceOrder: chunk.sequenceOrder,
          topicIndex: topic.topicOrder,
          topicText: topic.topicText,
          chunkText: chunk.text,
        };
      }),
    replacePermutationsForCard: ({ sourceCardId, permutations: nextPermutations }) =>
      Effect.sync(() => {
        const retained = permutations.filter(
          (permutation) => permutation.sourceCardId !== sourceCardId,
        );
        const staged = nextPermutations.map((permutation, permutationOrder) => ({
          id: nextPermutationId + permutationOrder,
          sourceCardId,
          permutationOrder,
          question: permutation.question,
          answer: permutation.answer,
        }));

        permutations.length = 0;
        permutations.push(...retained, ...staged);
        nextPermutationId += staged.length;
      }),
    getPermutationsForCard: (sourceCardId) =>
      Effect.sync(() => {
        return permutations
          .filter((entry) => entry.sourceCardId === sourceCardId)
          .sort(
            (left, right) => left.permutationOrder - right.permutationOrder || left.id - right.id,
          )
          .map((entry) => ({
            id: entry.id,
            sourceCardId: entry.sourceCardId,
            permutationOrder: entry.permutationOrder,
            question: entry.question,
            answer: entry.answer,
          }));
      }),
    upsertClozeForCard: ({ sourceCardId, clozeText }) =>
      Effect.sync(() => {
        const next: InMemoryCardCloze = {
          sourceCardId,
          clozeText,
        };
        clozeBySourceCardId.set(sourceCardId, next);
        return { ...next };
      }),
    getClozeForCard: (sourceCardId) =>
      Effect.sync(() => {
        const cloze = clozeBySourceCardId.get(sourceCardId);
        return cloze ? { ...cloze } : null;
      }),
    recoverStaleGeneratingTopics: ({ sessionId, staleBeforeIso, message }) =>
      Effect.sync(() => {
        const staleBefore = Date.parse(staleBeforeIso);
        if (Number.isNaN(staleBefore)) {
          return 0;
        }

        const sessionChunkIds = new Set(
          chunks.filter((chunk) => chunk.sessionId === sessionId).map((chunk) => chunk.id),
        );
        const sessionTopicIds = new Set(
          topics
            .filter((topic) => sessionChunkIds.has(topic.chunkId))
            .map((topic) => topic.id),
        );

        let updated = 0;
        for (const topicId of sessionTopicIds) {
          const generation = topicGeneration.get(topicId);
          if (!generation) continue;
          if (generation.status !== "generating") continue;
          if (!generation.generationStartedAt) continue;

          const startedAt = Date.parse(generation.generationStartedAt);
          if (Number.isNaN(startedAt) || startedAt >= staleBefore) continue;

          const next: InMemoryTopicGeneration = {
            ...generation,
            status: "error",
            errorMessage: message,
            generationStartedAt: null,
            statusChangedAt: nowIso(),
          };
          topicGeneration.set(topicId, next);
          updated += 1;
        }

        return updated;
      }),
    getChunkCount: (sessionId) =>
      Effect.sync(() => chunks.filter((entry) => entry.sessionId === sessionId).length),
  };
};
