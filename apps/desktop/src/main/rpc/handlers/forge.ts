import path from "node:path";

import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import {
  ChunkService,
  ForgePromptRuntimeService,
  ForgeSessionRepositoryService,
  PdfExtractorService,
} from "@main/di";
import { GetTopicsPromptSpec } from "@main/forge/prompts";
import type {
  ForgeSessionRepositoryError,
  ForgeSessionStatusTransitionError,
} from "@main/forge/services/forge-session-repository";
import type { PdfTextExtractError } from "@main/forge/services/pdf-extractor";
import { toErrorMessage } from "@main/utils/format";
import type { AppContract } from "@shared/rpc/contracts";
import {
  ForgeEmptySourceTextError,
  ForgeOperationError,
  ForgePreviewEmptySourceTextError,
  ForgePreviewOperationError,
  ForgePreviewPdfExtractionError,
  ForgeSessionAlreadyChunkedError,
  ForgeSessionBusyError,
  ForgeSessionNotFoundError,
  ForgeSessionOperationError,
  ForgeTopicExtractionError,
  PdfExtractionError,
} from "@shared/rpc/schemas/forge";

type ForgeHandlerKeys =
  | "ForgeCreateSession"
  | "ForgeExtractText"
  | "ForgePreviewChunks"
  | "ForgeStartTopicExtraction";

const PREVIEW_LENGTH = 500;

const MAX_REQUEST_CONCURRENCY = 8;

const toForgeOperationError = (error: unknown): ForgeOperationError =>
  new ForgeOperationError({ message: toErrorMessage(error) });

const toSessionOperationErrorFromRepositoryError = (
  sessionId: number,
  error: ForgeSessionRepositoryError,
): ForgeSessionOperationError =>
  new ForgeSessionOperationError({
    sessionId,
    message: toErrorMessage(error),
  });

const toSessionOperationErrorFromStatusTransitionError = (
  sessionId: number,
  error: ForgeSessionStatusTransitionError,
): ForgeSessionOperationError =>
  new ForgeSessionOperationError({
    sessionId,
    message: `Invalid Forge status transition for session ${error.sessionId}: ${error.fromStatus} -> ${error.toStatus}`,
  });

const mapOperationError = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, ForgeOperationError> => effect.pipe(Effect.mapError(toForgeOperationError));

const mapRepositoryStatusUpdateError = <A>(
  effect: Effect.Effect<A, ForgeSessionRepositoryError | ForgeSessionStatusTransitionError>,
): Effect.Effect<A, ForgeOperationError> =>
  effect.pipe(
    Effect.catchTag("ForgeSessionRepositoryError", (error) =>
      Effect.fail(toForgeOperationError(error)),
    ),
    Effect.catchTag("ForgeSessionStatusTransitionError", (error) =>
      Effect.fail(
        new ForgeOperationError({
          message: `Invalid Forge status transition for session ${error.sessionId}: ${error.fromStatus} -> ${error.toStatus}`,
        }),
      ),
    ),
  );

const mapSessionRepositoryStatusUpdateError = <A>(
  sessionId: number,
  effect: Effect.Effect<A, ForgeSessionRepositoryError | ForgeSessionStatusTransitionError>,
): Effect.Effect<A, ForgeSessionOperationError> =>
  effect.pipe(
    Effect.catchTag("ForgeSessionRepositoryError", (error) =>
      Effect.fail(toSessionOperationErrorFromRepositoryError(sessionId, error)),
    ),
    Effect.catchTag("ForgeSessionStatusTransitionError", (error) =>
      Effect.fail(toSessionOperationErrorFromStatusTransitionError(sessionId, error)),
    ),
  );

const mapSessionRepositoryError = <A>(
  sessionId: number,
  effect: Effect.Effect<A, ForgeSessionRepositoryError>,
): Effect.Effect<A, ForgeSessionOperationError> =>
  effect.pipe(
    Effect.mapError((error) => toSessionOperationErrorFromRepositoryError(sessionId, error)),
  );

const ensureSessionExists = <T>(session: T | null, sessionId: number) =>
  session === null
    ? Effect.fail(new ForgeSessionNotFoundError({ sessionId }))
    : Effect.succeed(session);

const ensureSessionExistsForStart = <T>(session: T | null, sessionId: number) =>
  session === null
    ? Effect.fail(
        new ForgeSessionOperationError({
          sessionId,
          message: `Forge session ${sessionId} was not found during topic extraction.`,
        }),
      )
    : Effect.succeed(session);

const toPdfExtractionError = (sessionId: number, error: PdfTextExtractError): PdfExtractionError =>
  new PdfExtractionError({
    sessionId,
    sourceFilePath: error.sourceFilePath,
    message: error.message,
  });

const toPreviewPdfExtractionError = (
  sourceFilePath: string,
  error: PdfTextExtractError,
): ForgePreviewPdfExtractionError =>
  new ForgePreviewPdfExtractionError({
    sourceFilePath,
    message: error.message,
  });

const toErrorMessageForSessionStatus = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return toErrorMessage(error);
};

export const createForgeHandlers = () =>
  Effect.gen(function* () {
    const forgeSessionRepository = yield* ForgeSessionRepositoryService;
    const pdfExtractor = yield* PdfExtractorService;
    const chunkService = yield* ChunkService;
    const forgePromptRuntime = yield* ForgePromptRuntimeService;

    const setSessionErrorBestEffort = (
      sessionId: number,
      message: string,
      logContext: string,
    ): Effect.Effect<void> =>
      forgeSessionRepository
        .setSessionStatus({
          sessionId,
          status: "error",
          errorMessage: message,
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error(`${logContext} failed to mark session as error`, {
                sessionId,
                originalMessage: message,
                error: toErrorMessage(error),
              });
            }),
          ),
          Effect.asVoid,
        );

    const failBeginExtractionConflict = (sessionId: number) =>
      Effect.gen(function* () {
        const latestSession = yield* mapOperationError(
          forgeSessionRepository.getSession(sessionId),
        ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

        const alreadyHasChunks = yield* mapOperationError(
          forgeSessionRepository.hasChunks(sessionId),
        );

        if (latestSession.status === "extracting") {
          return yield* Effect.fail(
            new ForgeSessionBusyError({
              sessionId,
              status: latestSession.status,
            }),
          );
        }

        if (alreadyHasChunks) {
          return yield* Effect.fail(
            new ForgeSessionAlreadyChunkedError({
              sessionId,
              message: `Session ${sessionId} already has persisted chunks.`,
            }),
          );
        }

        return yield* Effect.fail(
          new ForgeOperationError({
            message: `Session ${sessionId} cannot begin extraction from status ${latestSession.status}.`,
          }),
        );
      });

    const createSessionFromSourcePath = (sourceFilePath: string) =>
      Effect.gen(function* () {
        if (!path.isAbsolute(sourceFilePath)) {
          return yield* Effect.fail(
            new ForgeOperationError({
              message: `Forge sourceFilePath must be absolute: ${sourceFilePath}`,
            }),
          );
        }

        const sourceFingerprint = yield* mapOperationError(
          pdfExtractor.resolveFingerprint(sourceFilePath),
        );

        const duplicateSession = yield* mapOperationError(
          forgeSessionRepository.findLatestBySourceFingerprint({
            sourceKind: "pdf",
            sourceFingerprint,
          }),
        );

        const session = yield* mapOperationError(
          forgeSessionRepository.createSession({
            sourceKind: "pdf",
            sourceFilePath,
            deckPath: null,
            sourceFingerprint,
          }),
        );

        return {
          session,
          duplicateOfSessionId: duplicateSession?.id ?? null,
        };
      });

    const extractAndChunkForSession = (sessionId: number, sourceFilePath: string) =>
      Effect.gen(function* () {
        const extracted = yield* pdfExtractor
          .extractText(sourceFilePath)
          .pipe(Effect.mapError((error) => toPdfExtractionError(sessionId, error)));

        if (extracted.text.trim().length === 0) {
          const message = `No extractable text found in PDF source: ${sourceFilePath}`;
          return yield* Effect.fail(
            new ForgeEmptySourceTextError({
              sessionId,
              sourceFilePath,
              message,
            }),
          );
        }

        const chunkResult = yield* chunkService.chunkText({
          text: extracted.text,
          pageBreaks: extracted.pageBreaks,
        });

        return {
          extracted,
          chunkResult,
          extraction: {
            sessionId,
            textLength: extracted.text.length,
            preview: extracted.text.slice(0, PREVIEW_LENGTH),
            totalPages: extracted.totalPages,
            chunkCount: chunkResult.chunkCount,
          },
        };
      });

    const handlers: Pick<Implementations<AppContract, never>, ForgeHandlerKeys> = {
      ForgeCreateSession: ({ sourceFilePath }) => createSessionFromSourcePath(sourceFilePath),
      ForgeExtractText: ({ sessionId }) =>
        Effect.gen(function* () {
          const begunSession = yield* mapOperationError(
            forgeSessionRepository.tryBeginExtraction(sessionId),
          );

          if (begunSession === null) {
            return yield* failBeginExtractionConflict(sessionId);
          }

          const extractionEffect = Effect.gen(function* () {
            const extractedAndChunked = yield* extractAndChunkForSession(
              sessionId,
              begunSession.sourceFilePath,
            ).pipe(
              Effect.catchTag("empty_text", (error) =>
                mapRepositoryStatusUpdateError(
                  forgeSessionRepository.setSessionStatus({
                    sessionId,
                    status: "error",
                    errorMessage: error.message,
                  }),
                ).pipe(Effect.zipRight(Effect.fail(error))),
              ),
            );

            yield* mapOperationError(
              forgeSessionRepository.saveChunks(sessionId, extractedAndChunked.chunkResult.chunks),
            );

            yield* mapRepositoryStatusUpdateError(
              forgeSessionRepository.setSessionStatus({
                sessionId,
                status: "extracted",
                errorMessage: null,
              }),
            ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

            yield* Effect.sync(() => {
              console.log("[forge/extract]", {
                sessionId,
                textLength: extractedAndChunked.extraction.textLength,
                chunkCount: extractedAndChunked.extraction.chunkCount,
                totalPages: extractedAndChunked.extraction.totalPages,
              });
            });

            return extractedAndChunked.extraction;
          });

          return yield* extractionEffect.pipe(
            Effect.catchTags({
              session_not_found: (error) => Effect.fail(error),
              empty_text: (error) => Effect.fail(error),
              pdf_extraction_error: (error) =>
                setSessionErrorBestEffort(sessionId, error.message, "[forge/extract]").pipe(
                  Effect.zipRight(Effect.fail(error)),
                ),
              forge_operation_error: (error) =>
                setSessionErrorBestEffort(sessionId, error.message, "[forge/extract]").pipe(
                  Effect.zipRight(Effect.fail(error)),
                ),
            }),
          );
        }),
      ForgePreviewChunks: ({ sourceFilePath }) =>
        Effect.gen(function* () {
          if (!path.isAbsolute(sourceFilePath)) {
            return yield* Effect.fail(
              new ForgePreviewOperationError({
                sourceFilePath,
                message: `Forge sourceFilePath must be absolute: ${sourceFilePath}`,
              }),
            );
          }

          const extracted = yield* pdfExtractor
            .extractText(sourceFilePath)
            .pipe(Effect.mapError((error) => toPreviewPdfExtractionError(sourceFilePath, error)));

          if (extracted.text.trim().length === 0) {
            return yield* Effect.fail(
              new ForgePreviewEmptySourceTextError({
                sourceFilePath,
                message: `No extractable text found in PDF source: ${sourceFilePath}`,
              }),
            );
          }

          const chunkResult = yield* chunkService.chunkText({
            text: extracted.text,
            pageBreaks: extracted.pageBreaks,
          });

          return {
            textLength: extracted.text.length,
            totalPages: extracted.totalPages,
            chunkCount: chunkResult.chunkCount,
          };
        }),
      ForgeStartTopicExtraction: ({ sourceFilePath, model }) =>
        createSessionFromSourcePath(sourceFilePath).pipe(
          Effect.flatMap(({ session, duplicateOfSessionId }) =>
            Effect.gen(function* () {
              yield* mapSessionRepositoryStatusUpdateError(
                session.id,
                forgeSessionRepository.setSessionStatus({
                  sessionId: session.id,
                  status: "extracting",
                  errorMessage: null,
                }),
              ).pipe(Effect.flatMap((current) => ensureSessionExistsForStart(current, session.id)));

              const extractedAndChunked = yield* extractAndChunkForSession(
                session.id,
                session.sourceFilePath,
              );

              yield* mapSessionRepositoryError(
                session.id,
                forgeSessionRepository.saveChunks(
                  session.id,
                  extractedAndChunked.chunkResult.chunks,
                ),
              );

              yield* mapSessionRepositoryStatusUpdateError(
                session.id,
                forgeSessionRepository.setSessionStatus({
                  sessionId: session.id,
                  status: "extracted",
                  errorMessage: null,
                }),
              ).pipe(Effect.flatMap((current) => ensureSessionExistsForStart(current, session.id)));

              yield* mapSessionRepositoryStatusUpdateError(
                session.id,
                forgeSessionRepository.setSessionStatus({
                  sessionId: session.id,
                  status: "topics_extracting",
                  errorMessage: null,
                }),
              ).pipe(Effect.flatMap((current) => ensureSessionExistsForStart(current, session.id)));

              const chunks = yield* mapSessionRepositoryError(
                session.id,
                forgeSessionRepository.getChunks(session.id),
              );

              if (chunks.length === 0) {
                return yield* Effect.fail(
                  new ForgeTopicExtractionError({
                    sessionId: session.id,
                    message: `No persisted chunks found for session ${session.id}.`,
                  }),
                );
              }

              const topicsByChunkWrites = yield* Effect.forEach(
                chunks,
                (chunk) =>
                  forgePromptRuntime
                    .run(
                      GetTopicsPromptSpec,
                      {
                        chunkText: chunk.text,
                      },
                      model ? { model } : undefined,
                    )
                    .pipe(
                      Effect.map((result) => ({
                        chunkId: chunk.id,
                        sequenceOrder: chunk.sequenceOrder,
                        topics: result.output.topics,
                      })),
                      Effect.catchTag("PromptModelInvocationError", (error) =>
                        Effect.fail(
                          new ForgeTopicExtractionError({
                            sessionId: session.id,
                            chunkId: chunk.id,
                            sequenceOrder: chunk.sequenceOrder,
                            message: `Model invocation failed for ${error.model}: ${toErrorMessage(error.cause)}`,
                          }),
                        ),
                      ),
                      Effect.mapError(
                        (error) =>
                          new ForgeTopicExtractionError({
                            sessionId: session.id,
                            chunkId: chunk.id,
                            sequenceOrder: chunk.sequenceOrder,
                            message: toErrorMessage(error),
                          }),
                      ),
                    ),
                { concurrency: MAX_REQUEST_CONCURRENCY },
              );

              yield* mapSessionRepositoryError(
                session.id,
                forgeSessionRepository.replaceTopicsForSession(
                  session.id,
                  topicsByChunkWrites.map((write) => ({
                    sequenceOrder: write.sequenceOrder,
                    topics: write.topics,
                  })),
                ),
              );

              yield* mapSessionRepositoryStatusUpdateError(
                session.id,
                forgeSessionRepository.setSessionStatus({
                  sessionId: session.id,
                  status: "topics_extracted",
                  errorMessage: null,
                }),
              ).pipe(Effect.flatMap((current) => ensureSessionExistsForStart(current, session.id)));

              const finalSession = yield* mapSessionRepositoryError(
                session.id,
                forgeSessionRepository.getSession(session.id),
              ).pipe(Effect.flatMap((current) => ensureSessionExistsForStart(current, session.id)));

              const topicsByChunk = yield* mapSessionRepositoryError(
                session.id,
                forgeSessionRepository.getTopicsBySession(session.id),
              );

              yield* Effect.sync(() => {
                console.log("[forge/topics]", {
                  sessionId: session.id,
                  chunkCount: extractedAndChunked.extraction.chunkCount,
                  topicsByChunkCount: topicsByChunk.length,
                });
              });

              return {
                session: finalSession,
                duplicateOfSessionId,
                extraction: extractedAndChunked.extraction,
                topicsByChunk,
              };
            }).pipe(
              Effect.catchAll((error) =>
                setSessionErrorBestEffort(
                  session.id,
                  toErrorMessageForSessionStatus(error),
                  "[forge/start]",
                ).pipe(Effect.zipRight(Effect.fail(error))),
              ),
            ),
          ),
        ),
    };

    return handlers;
  });
