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
  readonly getTopicsBySession: (
    sessionId: number,
  ) => Effect.Effect<ReadonlyArray<ForgeChunkTopics>, ForgeSessionRepositoryError>;
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

const toForgeChunk = (
  row: ForgeChunkRow,
): Effect.Effect<ForgeChunk, ForgeSessionRepositoryError> =>
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

export const makeInMemoryForgeSessionRepository = (): ForgeSessionRepository => {
  let nextSessionId = 1;
  let nextChunkId = 1;
  let nextTopicId = 1;
  const sessions: ForgeSession[] = [];
  const chunks: InMemoryChunk[] = [];
  const topics: InMemoryTopic[] = [];

  const nowIso = (): string => new Date().toISOString();

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
    hasChunks: (sessionId) => Effect.sync(() => chunks.some((entry) => entry.sessionId === sessionId)),
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
        const retainedTopics = topics.filter((topic) => !sessionChunkIds.has(topic.chunkId));

        topics.length = 0;
        topics.push(...retainedTopics, ...stagedTopics);
        nextTopicId += stagedTopics.length;

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

        const grouped = new Map<number, { readonly chunkId: number; readonly sequenceOrder: number; readonly topics: Array<string> }>();
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
    getChunkCount: (sessionId) =>
      Effect.sync(() => chunks.filter((entry) => entry.sessionId === sessionId).length),
  };
};
