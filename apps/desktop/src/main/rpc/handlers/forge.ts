import path from "node:path";

import { Cause, Effect, Option } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import {
  AppEventPublisherService,
  ChunkService,
  ForgePromptRuntimeService,
  ForgeSessionRepositoryService,
  PdfExtractorService,
} from "@main/di";
import {
  CreateCardsPromptSpec,
  GenerateClozePromptSpec,
  GeneratePermutationsPromptSpec,
  GetTopicsPromptSpec,
} from "@main/forge/prompts";
import {
  type ForgeCardWithTopicContext,
  type ForgeTopicRef,
  type ForgeTopicRecord,
  type ForgeSessionRepositoryError,
  type ForgeSessionStatusTransitionError,
} from "@main/forge/services/forge-session-repository";
import type { PdfTextExtractError } from "@main/forge/services/pdf-extractor";
import { toErrorMessage } from "@main/utils/format";
import { ForgeTopicChunkExtracted, type AppContract } from "@shared/rpc/contracts";
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
  ForgeCardGenerationError,
  ForgeCardNotFoundError,
  ForgeClozeGenerationError,
  ForgePermutationGenerationError,
  ForgeTopicAlreadyGeneratingError,
  ForgeTopicNotFoundError,
  ForgeTopicExtractionError,
  PdfExtractionError,
} from "@shared/rpc/schemas/forge";

type ForgeHandlerKeys =
  | "ForgeCreateSession"
  | "ForgeExtractText"
  | "ForgePreviewChunks"
  | "ForgeStartTopicExtraction"
  | "ForgeGetTopicExtractionSnapshot"
  | "ForgeGetCardsSnapshot"
  | "ForgeGetTopicCards"
  | "ForgeGenerateTopicCards"
  | "ForgeGetCardPermutations"
  | "ForgeGenerateCardPermutations"
  | "ForgeGetCardCloze"
  | "ForgeGenerateCardCloze"
  | "ForgeUpdateCard";

const PREVIEW_LENGTH = 500;

const MAX_REQUEST_CONCURRENCY = 8;
const FORGE_TOPIC_GENERATION_STALE_TIMEOUT_MS = 120_000;
const FORGE_TOPIC_GENERATION_STALE_MESSAGE = "Generation interrupted; please retry.";

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

const ensureTopicExists = (
  topic: ForgeTopicRecord | null,
  input: ForgeTopicRef,
): Effect.Effect<ForgeTopicRecord, ForgeTopicNotFoundError> =>
  topic === null
    ? Effect.fail(
        new ForgeTopicNotFoundError({
          sessionId: input.sessionId,
          chunkId: input.chunkId,
          topicIndex: input.topicIndex,
        }),
      )
    : Effect.succeed(topic);

const ensureCardExists = (
  card: ForgeCardWithTopicContext | null,
  sourceCardId: number,
): Effect.Effect<ForgeCardWithTopicContext, ForgeCardNotFoundError> =>
  card === null
    ? Effect.fail(
        new ForgeCardNotFoundError({
          sourceCardId,
        }),
      )
    : Effect.succeed(card);

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

const toFailureMessageFromCause = <E>(cause: Cause.Cause<E>): string => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    return toErrorMessage(failure.value);
  }

  const defect = Cause.dieOption(cause);
  if (Option.isSome(defect)) {
    return toErrorMessage(defect.value);
  }

  return Cause.pretty(cause);
};

export const createForgeHandlers = () =>
  Effect.gen(function* () {
    const forgeSessionRepository = yield* ForgeSessionRepositoryService;
    const pdfExtractor = yield* PdfExtractorService;
    const chunkService = yield* ChunkService;
    const forgePromptRuntime = yield* ForgePromptRuntimeService;
    const appEventPublisher = yield* AppEventPublisherService;

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

    const publishChunkExtractedBestEffort = (payload: {
      readonly sourceFilePath: string;
      readonly sessionId: number;
      readonly chunkId: number;
      readonly sequenceOrder: number;
      readonly topics: ReadonlyArray<string>;
    }): Effect.Effect<void> =>
      appEventPublisher
        .publish(ForgeTopicChunkExtracted, {
          sourceFilePath: payload.sourceFilePath,
          sessionId: payload.sessionId,
          chunk: {
            chunkId: payload.chunkId,
            sequenceOrder: payload.sequenceOrder,
            topics: payload.topics,
          },
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error("[forge/topics] failed to publish chunk event", {
                sessionId: payload.sessionId,
                chunkId: payload.chunkId,
                sequenceOrder: payload.sequenceOrder,
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

    const recoverStaleGeneratingTopics = (sessionId: number) => {
      const staleBeforeIso = new Date(
        Date.now() - FORGE_TOPIC_GENERATION_STALE_TIMEOUT_MS,
      ).toISOString();

      return mapSessionRepositoryError(
        sessionId,
        forgeSessionRepository.recoverStaleGeneratingTopics({
          sessionId,
          staleBeforeIso,
          message: FORGE_TOPIC_GENERATION_STALE_MESSAGE,
        }),
      ).pipe(Effect.asVoid);
    };

    const setTopicGenerationErrorBestEffort = (input: {
      readonly topicId: number;
      readonly sessionId: number;
      readonly message: string;
      readonly logContext: string;
    }): Effect.Effect<void> =>
      forgeSessionRepository
        .finishTopicGenerationError({
          topicId: input.topicId,
          message: input.message,
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error(`${input.logContext} failed to mark topic as error`, {
                topicId: input.topicId,
                sessionId: input.sessionId,
                originalMessage: input.message,
                error: toErrorMessage(error),
              });
            }),
          ),
          Effect.asVoid,
        );

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
      ForgeGetTopicExtractionSnapshot: ({ sourceFilePath }) =>
        Effect.gen(function* () {
          if (!path.isAbsolute(sourceFilePath)) {
            return yield* Effect.fail(
              new ForgeOperationError({
                message: `Forge sourceFilePath must be absolute: ${sourceFilePath}`,
              }),
            );
          }

          const session = yield* mapOperationError(
            forgeSessionRepository.findLatestBySourceFilePath({
              sourceKind: "pdf",
              sourceFilePath,
            }),
          );

          if (!session) {
            return {
              session: null,
              topicsByChunk: [],
            };
          }

          const topicsByChunk = yield* mapSessionRepositoryError(
            session.id,
            forgeSessionRepository.getTopicsBySession(session.id),
          );

          return {
            session,
            topicsByChunk,
          };
        }),
      ForgeGetCardsSnapshot: ({ sessionId }) =>
        Effect.gen(function* () {
          yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getSession(sessionId),
          ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

          yield* recoverStaleGeneratingTopics(sessionId);

          const topics = yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getCardsSnapshotBySession(sessionId),
          );

          return {
            topics: topics.map((row) => ({
              topicId: row.topicId,
              chunkId: row.chunkId,
              sequenceOrder: row.sequenceOrder,
              topicIndex: row.topicIndex,
              topicText: row.topicText,
              status: row.status,
              errorMessage: row.errorMessage,
              cardCount: row.cardCount,
              generationRevision: row.generationRevision,
            })),
          };
        }),
      ForgeGetTopicCards: ({ sessionId, chunkId, topicIndex }) =>
        Effect.gen(function* () {
          const topicRef: ForgeTopicRef = { sessionId, chunkId, topicIndex };

          yield* recoverStaleGeneratingTopics(sessionId);

          const result = yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getCardsForTopicRef(topicRef),
          );
          if (!result) {
            return yield* Effect.fail(
              new ForgeTopicNotFoundError({
                sessionId,
                chunkId,
                topicIndex,
              }),
            );
          }

          return {
            topic: {
              topicId: result.topic.topicId,
              chunkId: result.topic.chunkId,
              sequenceOrder: result.topic.sequenceOrder,
              topicIndex: result.topic.topicIndex,
              topicText: result.topic.topicText,
              status: result.topic.status,
              errorMessage: result.topic.errorMessage,
              cardCount: result.topic.cardCount,
              generationRevision: result.topic.generationRevision,
            },
            cards: result.cards.map((card) => ({
              id: card.id,
              question: card.question,
              answer: card.answer,
            })),
          };
        }),
      ForgeGenerateTopicCards: ({ sessionId, chunkId, topicIndex, instruction, model }) =>
        Effect.gen(function* () {
          const topicRef: ForgeTopicRef = { sessionId, chunkId, topicIndex };
          let startedTopic: ForgeTopicRecord | null = null;
          let generationFinishedSuccessfully = false;

          const generationEffect = Effect.gen(function* () {
            const topic = yield* mapSessionRepositoryError(
              sessionId,
              forgeSessionRepository.getTopicByRef(topicRef),
            ).pipe(Effect.flatMap((current) => ensureTopicExists(current, topicRef)));

            yield* forgeSessionRepository.tryStartTopicGeneration(topic.topicId).pipe(
              Effect.catchTag("ForgeTopicAlreadyGeneratingRepositoryError", () =>
                Effect.fail(
                  new ForgeTopicAlreadyGeneratingError({
                    sessionId,
                    chunkId,
                    topicIndex,
                  }),
                ),
              ),
              Effect.catchTag("ForgeSessionRepositoryError", (error) =>
                Effect.fail(toSessionOperationErrorFromRepositoryError(sessionId, error)),
              ),
            );
            startedTopic = topic;

            const promptResult = yield* forgePromptRuntime
              .run(
                CreateCardsPromptSpec,
                {
                  chunkText: topic.chunkText,
                  topic: topic.topicText,
                  ...(instruction ? { instruction } : {}),
                },
                model ? { model } : undefined,
              )
              .pipe(
                Effect.mapError(
                  (error) =>
                    new ForgeCardGenerationError({
                      sessionId,
                      chunkId,
                      topicIndex,
                      message: toErrorMessage(error),
                    }),
                ),
              );

            yield* mapSessionRepositoryError(
              sessionId,
              forgeSessionRepository.replaceCardsForTopicAndFinishGenerationSuccess({
                topicId: topic.topicId,
                cards: promptResult.output.cards,
              }),
            );
            generationFinishedSuccessfully = true;

            const result = yield* mapSessionRepositoryError(
              sessionId,
              forgeSessionRepository.getCardsForTopicRef(topicRef),
            );

            if (!result) {
              return yield* Effect.fail(
                new ForgeTopicNotFoundError({
                  sessionId,
                  chunkId,
                  topicIndex,
                }),
              );
            }

            return {
              topic: {
                topicId: result.topic.topicId,
                chunkId: result.topic.chunkId,
                sequenceOrder: result.topic.sequenceOrder,
                topicIndex: result.topic.topicIndex,
                topicText: result.topic.topicText,
                status: result.topic.status,
                errorMessage: result.topic.errorMessage,
                cardCount: result.topic.cardCount,
                generationRevision: result.topic.generationRevision,
              },
              cards: result.cards.map((card) => ({
                id: card.id,
                question: card.question,
                answer: card.answer,
              })),
            };
          });

          return yield* generationEffect.pipe(
            Effect.tapErrorCause((cause) => {
              if (!startedTopic || generationFinishedSuccessfully) {
                return Effect.void;
              }

              return setTopicGenerationErrorBestEffort({
                topicId: startedTopic.topicId,
                sessionId: startedTopic.sessionId,
                message: toFailureMessageFromCause(cause),
                logContext: "[forge/cards]",
              });
            }),
          );
        }),
      ForgeGetCardPermutations: ({ sourceCardId }) =>
        Effect.gen(function* () {
          const sourceCard = yield* forgeSessionRepository
            .getCardById(sourceCardId)
            .pipe(
              Effect.mapError(toForgeOperationError),
              Effect.flatMap((card) => ensureCardExists(card, sourceCardId)),
            );

          const list = yield* mapSessionRepositoryError(
            sourceCard.sessionId,
            forgeSessionRepository.getPermutationsForCard(sourceCardId),
          );

          return {
            sourceCardId,
            permutations: list.map((entry) => ({
              id: entry.id,
              question: entry.question,
              answer: entry.answer,
            })),
          };
        }),
      ForgeGenerateCardPermutations: ({ sourceCardId, instruction, model }) =>
        Effect.gen(function* () {
          const sourceCard = yield* forgeSessionRepository
            .getCardById(sourceCardId)
            .pipe(
              Effect.mapError(toForgeOperationError),
              Effect.flatMap((card) => ensureCardExists(card, sourceCardId)),
            );

          const promptResult = yield* forgePromptRuntime
            .run(
              GeneratePermutationsPromptSpec,
              {
                chunkText: sourceCard.chunkText,
                source: {
                  question: sourceCard.question,
                  answer: sourceCard.answer,
                },
                ...(instruction ? { instruction } : {}),
              },
              model ? { model } : undefined,
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new ForgePermutationGenerationError({
                    sourceCardId,
                    message: toErrorMessage(error),
                  }),
              ),
            );

          yield* mapSessionRepositoryError(
            sourceCard.sessionId,
            forgeSessionRepository.replacePermutationsForCard({
              sourceCardId,
              permutations: promptResult.output.permutations,
            }),
          );

          const list = yield* mapSessionRepositoryError(
            sourceCard.sessionId,
            forgeSessionRepository.getPermutationsForCard(sourceCardId),
          );

          return {
            sourceCardId,
            permutations: list.map((entry) => ({
              id: entry.id,
              question: entry.question,
              answer: entry.answer,
            })),
          };
        }),
      ForgeGetCardCloze: ({ sourceCardId }) =>
        Effect.gen(function* () {
          const sourceCard = yield* forgeSessionRepository
            .getCardById(sourceCardId)
            .pipe(
              Effect.mapError(toForgeOperationError),
              Effect.flatMap((card) => ensureCardExists(card, sourceCardId)),
            );

          const cloze = yield* mapSessionRepositoryError(
            sourceCard.sessionId,
            forgeSessionRepository.getClozeForCard(sourceCardId),
          );

          return {
            sourceCardId,
            cloze: cloze?.clozeText ?? null,
          };
        }),
      ForgeGenerateCardCloze: ({ sourceCardId, instruction, model }) =>
        Effect.gen(function* () {
          const sourceCard = yield* forgeSessionRepository
            .getCardById(sourceCardId)
            .pipe(
              Effect.mapError(toForgeOperationError),
              Effect.flatMap((card) => ensureCardExists(card, sourceCardId)),
            );

          const promptResult = yield* forgePromptRuntime
            .run(
              GenerateClozePromptSpec,
              {
                chunkText: sourceCard.chunkText,
                source: {
                  question: sourceCard.question,
                  answer: sourceCard.answer,
                },
                ...(instruction ? { instruction } : {}),
              },
              model ? { model } : undefined,
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new ForgeClozeGenerationError({
                    sourceCardId,
                    message: toErrorMessage(error),
                  }),
              ),
            );

          const cloze = yield* mapSessionRepositoryError(
            sourceCard.sessionId,
            forgeSessionRepository.upsertClozeForCard({
              sourceCardId,
              clozeText: promptResult.output.cloze,
            }),
          );

          return {
            sourceCardId,
            cloze: cloze.clozeText,
          };
        }),
      ForgeUpdateCard: ({ cardId, question, answer }) =>
        Effect.gen(function* () {
          const sourceCard = yield* forgeSessionRepository
            .getCardById(cardId)
            .pipe(
              Effect.mapError(toForgeOperationError),
              Effect.flatMap((card) => ensureCardExists(card, cardId)),
            );

          const updatedCard = yield* mapSessionRepositoryError(
            sourceCard.sessionId,
            forgeSessionRepository.updateCardContent({
              cardId,
              question,
              answer,
            }),
          );

          if (!updatedCard) {
            return yield* Effect.fail(
              new ForgeCardNotFoundError({
                sourceCardId: cardId,
              }),
            );
          }

          return {
            card: {
              id: updatedCard.id,
              question: updatedCard.question,
              answer: updatedCard.answer,
            },
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

              yield* Effect.forEach(
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
                      Effect.flatMap((write) =>
                        mapSessionRepositoryError(
                          session.id,
                          forgeSessionRepository.replaceTopicsForChunk({
                            sessionId: session.id,
                            sequenceOrder: write.sequenceOrder,
                            topics: write.topics,
                          }),
                        ).pipe(
                          Effect.zipRight(
                            publishChunkExtractedBestEffort({
                              sourceFilePath: session.sourceFilePath,
                              sessionId: session.id,
                              chunkId: write.chunkId,
                              sequenceOrder: write.sequenceOrder,
                              topics: write.topics,
                            }),
                          ),
                          Effect.as(write),
                        ),
                      ),
                      Effect.catchTags({
                        PromptModelInvocationError: (error) =>
                          Effect.fail(
                            new ForgeTopicExtractionError({
                              sessionId: session.id,
                              chunkId: chunk.id,
                              sequenceOrder: chunk.sequenceOrder,
                              message: `Model invocation failed for ${error.model}: ${toErrorMessage(error.cause)}`,
                            }),
                          ),
                        PromptInputValidationError: (error) =>
                          Effect.fail(
                            new ForgeTopicExtractionError({
                              sessionId: session.id,
                              chunkId: chunk.id,
                              sequenceOrder: chunk.sequenceOrder,
                              message: toErrorMessage(error),
                            }),
                          ),
                        PromptOutputParseError: (error) =>
                          Effect.fail(
                            new ForgeTopicExtractionError({
                              sessionId: session.id,
                              chunkId: chunk.id,
                              sequenceOrder: chunk.sequenceOrder,
                              message: toErrorMessage(error),
                            }),
                          ),
                        PromptOutputValidationError: (error) =>
                          Effect.fail(
                            new ForgeTopicExtractionError({
                              sessionId: session.id,
                              chunkId: chunk.id,
                              sequenceOrder: chunk.sequenceOrder,
                              message: toErrorMessage(error),
                            }),
                          ),
                        PromptNormalizationError: (error) =>
                          Effect.fail(
                            new ForgeTopicExtractionError({
                              sessionId: session.id,
                              chunkId: chunk.id,
                              sequenceOrder: chunk.sequenceOrder,
                              message: toErrorMessage(error),
                            }),
                          ),
                        session_operation_error: (error) =>
                          Effect.fail(
                            new ForgeTopicExtractionError({
                              sessionId: session.id,
                              chunkId: chunk.id,
                              sequenceOrder: chunk.sequenceOrder,
                              message: error.message,
                            }),
                          ),
                      }),
                    ),
                { concurrency: MAX_REQUEST_CONCURRENCY },
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
                  toErrorMessage(error),
                  "[forge/start]",
                ).pipe(Effect.zipRight(Effect.fail(error))),
              ),
            ),
          ),
        ),
    };

    return handlers;
  });
