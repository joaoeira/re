import * as SqlClient from "@effect/sql/SqlClient";
import type * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Data, Effect, ManagedRuntime } from "effect";

import type {
  ForgeChunkPageBoundary,
  ForgeSession,
  ForgeSessionStatus,
  ForgeSourceKind,
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

  const runSqlRead = <A>(
    operation: string,
    effect: Effect.Effect<A, ForgeSessionRepositoryError, SqlClient.SqlClient>,
  ): Effect.Effect<A, ForgeSessionRepositoryError> => runSql(operation, effect);

  const runSqlWrite = <A>(
    operation: string,
    effect: Effect.Effect<
      A,
      ForgeSessionRepositoryError | ForgeSessionStatusTransitionError,
      SqlClient.SqlClient
    >,
  ): Effect.Effect<A, ForgeSessionRepositoryError | ForgeSessionStatusTransitionError> =>
    runSql(operation, effect);

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

  return {
    createSession: (input) =>
      runSqlRead(
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
      runSqlRead(
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
    getSession: (sessionId) => runSqlRead("getSession.runtime", loadSessionByIdSql(sessionId)),
    tryBeginExtraction: (sessionId) =>
      runSqlRead(
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
      runSqlWrite(
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
      runSqlRead(
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
    saveChunks: (sessionId, chunks) =>
      runSqlRead(
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
    getChunkCount: (sessionId) =>
      runSqlRead(
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

export const makeInMemoryForgeSessionRepository = (): ForgeSessionRepository => {
  let nextSessionId = 1;
  let nextChunkId = 1;
  const sessions: ForgeSession[] = [];
  const chunks: InMemoryChunk[] = [];

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
            pageBoundaries: row.pageBoundaries.map((boundary) => ({ ...boundary })),
            createdAt: nowIso(),
          });
        }

        nextChunkId += stagedRows.length;
        chunks.push(...stagedRows);

        return Effect.void;
      }),
    getChunkCount: (sessionId) =>
      Effect.sync(() => chunks.filter((entry) => entry.sessionId === sessionId).length),
  };
};
