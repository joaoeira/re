import path from "node:path";

import { Effect } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { ForgeSessionRepositoryService, PdfExtractorService } from "@main/di";
import type {
  ForgeSessionRepositoryError,
  ForgeSessionStatusTransitionError,
} from "@main/forge/services/forge-session-repository";
import { toErrorMessage } from "@main/utils/format";
import type { AppContract } from "@shared/rpc/contracts";
import { ForgeOperationError, ForgeSessionNotFoundError } from "@shared/rpc/schemas/forge";

type ForgeHandlerKeys = "ForgeCreateSession" | "ForgeExtractText";

const PREVIEW_LENGTH = 2000;

const toForgeOperationError = (error: unknown): ForgeOperationError =>
  new ForgeOperationError({ message: toErrorMessage(error) });

const mapOperationError = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, ForgeOperationError> => effect.pipe(Effect.mapError(toForgeOperationError));

const mapRepositoryStatusUpdateError = <A>(
  effect: Effect.Effect<A, ForgeSessionRepositoryError | ForgeSessionStatusTransitionError>,
): Effect.Effect<A, ForgeOperationError | ForgeSessionStatusTransitionError> =>
  effect.pipe(
    Effect.catchTag("ForgeSessionRepositoryError", (error) =>
      Effect.fail(toForgeOperationError(error)),
    ),
  );

const ensureSessionExists = <T>(session: T | null, sessionId: number) =>
  session === null
    ? Effect.fail(new ForgeSessionNotFoundError({ sessionId }))
    : Effect.succeed(session);

export const createForgeHandlers = () =>
  Effect.gen(function* () {
    const forgeSessionRepository = yield* ForgeSessionRepositoryService;
    const pdfExtractor = yield* PdfExtractorService;

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
          const existingSession = yield* mapOperationError(
            forgeSessionRepository.getSessionById(sessionId),
          ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

          const extractionEffect = Effect.gen(function* () {
            yield* mapRepositoryStatusUpdateError(
              forgeSessionRepository.updateSessionStatus({
                sessionId,
                status: "extracting",
                errorMessage: null,
              }),
            ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

            const extractedText = yield* mapOperationError(
              pdfExtractor.extractText(existingSession.sourceFilePath),
            );

            const preview = extractedText.slice(0, PREVIEW_LENGTH);
            const textLength = extractedText.length;

            yield* Effect.sync(() => {
              console.log("[forge/extract]", {
                sessionId,
                textLength,
              });
            });

            yield* mapRepositoryStatusUpdateError(
              forgeSessionRepository.updateSessionStatus({
                sessionId,
                status: "extracted",
                errorMessage: null,
              }),
            ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

            return {
              sessionId,
              textLength,
              preview,
            };
          });

          return yield* extractionEffect.pipe(
            Effect.catchTags({
              session_not_found: (error) => Effect.fail(error),
              ForgeSessionStatusTransitionError: (error) =>
                Effect.fail(
                  new ForgeOperationError({
                    message: `Invalid Forge status transition for session ${error.sessionId}: ${error.fromStatus} -> ${error.toStatus}`,
                  }),
                ),
              forge_operation_error: (error) =>
                mapOperationError(
                  forgeSessionRepository.updateSessionStatus({
                    sessionId,
                    status: "error",
                    errorMessage: error.message,
                  }),
                ).pipe(
                  Effect.catchAll(() => Effect.void),
                  Effect.zipRight(Effect.fail(error)),
                ),
            }),
          );
        }),
    };

    return handlers;
  });
