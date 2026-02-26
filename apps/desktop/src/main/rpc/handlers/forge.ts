import path from "node:path";

import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { ChunkService, ForgeSessionRepositoryService, PdfExtractorService } from "@main/di";
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
  ForgeSessionAlreadyChunkedError,
  ForgeSessionBusyError,
  ForgeSessionNotFoundError,
  PdfExtractionError,
} from "@shared/rpc/schemas/forge";

type ForgeHandlerKeys = "ForgeCreateSession" | "ForgeExtractText";

const PREVIEW_LENGTH = 500;

const toForgeOperationError = (error: unknown): ForgeOperationError =>
  new ForgeOperationError({ message: toErrorMessage(error) });

const mapOperationError = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, ForgeOperationError> => effect.pipe(Effect.mapError(toForgeOperationError));

const mapRepositoryStatusUpdateError = <A>(
  effect: Effect.Effect<A, ForgeSessionRepositoryError | ForgeSessionStatusTransitionError>,
): Effect.Effect<A, ForgeOperationError> =>
  effect.pipe(
    Effect.catchTag("ForgeSessionRepositoryError", (error) => Effect.fail(toForgeOperationError(error))),
    Effect.catchTag("ForgeSessionStatusTransitionError", (error) =>
      Effect.fail(
        new ForgeOperationError({
          message: `Invalid Forge status transition for session ${error.sessionId}: ${error.fromStatus} -> ${error.toStatus}`,
        }),
      ),
    ),
  );

const ensureSessionExists = <T>(session: T | null, sessionId: number) =>
  session === null
    ? Effect.fail(new ForgeSessionNotFoundError({ sessionId }))
    : Effect.succeed(session);

const toPdfExtractionError = (sessionId: number, error: PdfTextExtractError): PdfExtractionError =>
  new PdfExtractionError({
    sessionId,
    sourceFilePath: error.sourceFilePath,
    message: error.message,
  });

export const createForgeHandlers = () =>
  Effect.gen(function* () {
    const forgeSessionRepository = yield* ForgeSessionRepositoryService;
    const pdfExtractor = yield* PdfExtractorService;
    const chunkService = yield* ChunkService;

    const setSessionErrorBestEffort = (sessionId: number, message: string) =>
      mapRepositoryStatusUpdateError(
        forgeSessionRepository.setSessionStatus({
          sessionId,
          status: "error",
          errorMessage: message,
        }),
      ).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            console.error("[forge/extract] failed to mark session as error", {
              sessionId,
              originalMessage: message,
              error: toErrorMessage(error),
            });
          }),
        ),
        Effect.catchAll(() => Effect.void),
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

    const handlers: Pick<Implementations<AppContract, never>, ForgeHandlerKeys> = {
      ForgeCreateSession: ({ sourceFilePath }) =>
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
        }),
      ForgeExtractText: ({ sessionId }) =>
        Effect.gen(function* () {
          const begunSession = yield* mapOperationError(
            forgeSessionRepository.tryBeginExtraction(sessionId),
          );

          if (begunSession === null) {
            return yield* failBeginExtractionConflict(sessionId);
          }

          const extractionEffect = Effect.gen(function* () {
            const extracted = yield* pdfExtractor.extractText(begunSession.sourceFilePath).pipe(
              Effect.mapError((error) => toPdfExtractionError(sessionId, error)),
            );

            if (extracted.text.trim().length === 0) {
              const message = `No extractable text found in PDF source: ${begunSession.sourceFilePath}`;
              yield* mapRepositoryStatusUpdateError(
                forgeSessionRepository.setSessionStatus({
                  sessionId,
                  status: "error",
                  errorMessage: message,
                }),
              );

              yield* Effect.fail(
                new ForgeEmptySourceTextError({
                  sessionId,
                  sourceFilePath: begunSession.sourceFilePath,
                  message,
                }),
              );
            }

            const chunkResult = yield* chunkService.chunkText({
              text: extracted.text,
              pageBreaks: extracted.pageBreaks,
            });

            yield* mapOperationError(
              forgeSessionRepository.saveChunks(sessionId, chunkResult.chunks),
            );

            yield* mapRepositoryStatusUpdateError(
              forgeSessionRepository.setSessionStatus({
                sessionId,
                status: "extracted",
                errorMessage: null,
              }),
            ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

            const chunkCount = chunkResult.chunkCount;

            const preview = extracted.text.slice(0, PREVIEW_LENGTH);
            const textLength = extracted.text.length;

            yield* Effect.sync(() => {
              console.log("[forge/extract]", {
                sessionId,
                textLength,
                chunkCount,
                totalPages: extracted.totalPages,
              });
            });

            return {
              sessionId,
              textLength,
              preview,
              totalPages: extracted.totalPages,
              chunkCount,
            };
          });

          return yield* extractionEffect.pipe(
            Effect.catchTags({
              session_not_found: (error) => Effect.fail(error),
              empty_text: (error) => Effect.fail(error),
              pdf_extraction_error: (error) =>
                setSessionErrorBestEffort(sessionId, error.message).pipe(
                  Effect.zipRight(Effect.fail(error)),
                ),
              forge_operation_error: (error) =>
                setSessionErrorBestEffort(sessionId, error.message).pipe(
                  Effect.zipRight(Effect.fail(error)),
                ),
            }),
          );
        }),
    };

    return handlers;
  });
