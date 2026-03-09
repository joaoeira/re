import { createMetadata } from "@re/core";
import { ClozeType, QAType } from "@re/types";
import { DeckManager } from "@re/workspace";
import { Cause, Effect, Option } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import {
  AppEventPublisherService,
  ChunkService,
  DeckWriteCoordinatorService,
  ForgePromptRuntimeService,
  ForgeSourceResolverService,
  ForgeSessionRepositoryService,
  SettingsRepositoryService,
  TopicGroundingTextResolverService,
} from "@main/di";
import { DeckManagerServicesLive, validateDeckAccessAs } from "./shared";
import {
  CreateCardsPromptSpec,
  CreateSynthesisCardsPromptSpec,
  GenerateClozePromptSpec,
  GenerateExpansionsPromptSpec,
  GeneratePermutationsPromptSpec,
  ReformulateCardPromptSpec,
  GetSynthesisTopicsPromptSpec,
  GetTopicsPromptSpec,
} from "@main/forge/prompts";
import {
  type ForgeCardDerivation,
  type ForgeCardWithTopicContext,
  type ForgeSessionRepositoryError,
  type ForgeSessionStatusTransitionError,
} from "@main/forge/services/forge-session-repository";
import type {
  ForgeSourceResolverEmptyTextError,
  ForgeSourceResolverError,
  ResolvedForgeSourceContent,
  ResolvedForgeSourceMetadata,
} from "@main/forge/services/source-resolver";
import { toErrorMessage } from "@main/utils/format";
import {
  ForgeSynthesisTopicsExtracted,
  ForgeTopicChunkExtracted,
  ForgeExtractionSessionCreated,
  type AppContract,
} from "@shared/rpc/contracts";
import {
  isCardParentRef,
  toDerivationParentRefKey,
  type DerivationKind,
  type DerivationParentRef,
  ForgeEmptySourceTextError,
  ForgeOperationError,
  ForgePreviewEmptySourceTextError,
  ForgeSessionAlreadyChunkedError,
  ForgeSessionBusyError,
  ForgeSessionNotFoundError,
  ForgeSessionOperationError,
  ForgeCardGenerationError,
  ForgeCardNotFoundError,
  ForgeCardReformulationError,
  ForgeClozeGenerationError,
  ForgeDerivationAlreadyGeneratingError,
  ForgeDerivationGenerationError,
  ForgeDerivationNotFoundError,
  type ForgeSession,
  type ForgeSourceInput,
  ForgeSourceMismatchError,
  ForgeSourceResolveError,
  ForgeTopicAlreadyGeneratingError,
  ForgeTopicNotFoundError,
  ForgeTopicExtractionError,
} from "@shared/rpc/schemas/forge";

type ForgeHandlerKeys =
  | "ForgeCreateSession"
  | "ForgeExtractText"
  | "ForgeListSessions"
  | "ForgePreviewChunks"
  | "ForgeStartTopicExtraction"
  | "ForgeGetTopicExtractionSnapshot"
  | "ForgeGetCardsSnapshot"
  | "ForgeGetTopicCards"
  | "ForgeGenerateTopicCards"
  | "ForgeGenerateSelectedTopicCards"
  | "ForgeGetDerivedCards"
  | "ForgeGenerateDerivedCards"
  | "ForgeGetCardCloze"
  | "ForgeGenerateCardCloze"
  | "ForgeReformulateCard"
  | "ForgeUpdateCard"
  | "ForgeUpdateDerivation"
  | "ForgeSaveTopicSelections"
  | "ForgeSetSessionDeckPath"
  | "ForgeAddCardToDeck";

const PREVIEW_LENGTH = 500;

const MAX_REQUEST_CONCURRENCY = 8;
const DEFAULT_TOPIC_GENERATION_BATCH_CONCURRENCY = 5;
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

const ensureDerivationExists = (
  derivation: ForgeCardDerivation | null,
  derivationId: number,
): Effect.Effect<ForgeCardDerivation, ForgeDerivationNotFoundError> =>
  derivation === null
    ? Effect.fail(
        new ForgeDerivationNotFoundError({
          derivationId,
        }),
      )
    : Effect.succeed(derivation);

const toDerivationLockKey = (parent: DerivationParentRef, kind: DerivationKind): string =>
  `${toDerivationParentRefKey(parent)}:${kind}`;

const toSourceResolveError = (input: {
  readonly sessionId?: number;
  readonly sourceKind: "pdf" | "text";
  readonly sourceLabel: string;
  readonly message: string;
}): ForgeSourceResolveError =>
  new ForgeSourceResolveError({
    ...(typeof input.sessionId === "number" ? { sessionId: input.sessionId } : {}),
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    message: input.message,
  });

const toEmptySourceTextError = (input: {
  readonly sessionId?: number;
  readonly sourceKind: "pdf" | "text";
  readonly sourceLabel: string;
  readonly message: string;
}): ForgeEmptySourceTextError =>
  new ForgeEmptySourceTextError({
    ...(typeof input.sessionId === "number" ? { sessionId: input.sessionId } : {}),
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    message: input.message,
  });

const toPreviewEmptySourceTextError = (input: {
  readonly sourceKind: "pdf" | "text";
  readonly sourceLabel: string;
  readonly message: string;
}): ForgePreviewEmptySourceTextError =>
  new ForgePreviewEmptySourceTextError({
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    message: input.message,
  });

const mapSourceResolverErrorForSession = <A>(
  sessionId: number | undefined,
  effect: Effect.Effect<A, ForgeSourceResolverError | ForgeSourceResolverEmptyTextError>,
): Effect.Effect<A, ForgeSourceResolveError | ForgeEmptySourceTextError> =>
  effect.pipe(
    Effect.catchTag("ForgeSourceResolverError", (error) =>
      Effect.fail(
        toSourceResolveError({
          ...(typeof sessionId === "number" ? { sessionId } : {}),
          sourceKind: error.sourceKind,
          sourceLabel: error.sourceLabel,
          message: error.message,
        }),
      ),
    ),
    Effect.catchTag("ForgeSourceResolverEmptyTextError", (error) =>
      Effect.fail(
        toEmptySourceTextError({
          ...(typeof sessionId === "number" ? { sessionId } : {}),
          sourceKind: error.sourceKind,
          sourceLabel: error.sourceLabel,
          message: error.message,
        }),
      ),
    ),
  );

const mapSourceResolverErrorForPreview = <A>(
  effect: Effect.Effect<A, ForgeSourceResolverError | ForgeSourceResolverEmptyTextError>,
): Effect.Effect<A, ForgeSourceResolveError | ForgePreviewEmptySourceTextError> =>
  effect.pipe(
    Effect.catchTag("ForgeSourceResolverError", (error) =>
      Effect.fail(
        toSourceResolveError({
          sourceKind: error.sourceKind,
          sourceLabel: error.sourceLabel,
          message: error.message,
        }),
      ),
    ),
    Effect.catchTag("ForgeSourceResolverEmptyTextError", (error) =>
      Effect.fail(
        toPreviewEmptySourceTextError({
          sourceKind: error.sourceKind,
          sourceLabel: error.sourceLabel,
          message: error.message,
        }),
      ),
    ),
  );

const ensureSessionSourceMatches = <T extends ResolvedForgeSourceMetadata>(
  session: ForgeSession,
  resolvedSource: T,
): Effect.Effect<T, ForgeSourceMismatchError> =>
  session.sourceKind === resolvedSource.sourceKind &&
  session.sourceFingerprint === resolvedSource.sourceFingerprint
    ? Effect.succeed(resolvedSource)
    : Effect.fail(
        new ForgeSourceMismatchError({
          sessionId: session.id,
          expectedSourceKind: session.sourceKind,
          expectedSourceLabel: session.sourceLabel,
          actualSourceKind: resolvedSource.sourceKind,
          actualSourceLabel: resolvedSource.sourceLabel,
          message:
            "The provided forge source does not match the source originally used to create this session.",
        }),
      );

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
    const settingsRepository = yield* SettingsRepositoryService;
    const forgeSourceResolver = yield* ForgeSourceResolverService;
    const chunkService = yield* ChunkService;
    const forgePromptRuntime = yield* ForgePromptRuntimeService;
    const topicGroundingTextResolver = yield* TopicGroundingTextResolverService;
    const appEventPublisher = yield* AppEventPublisherService;
    const deckWriteCoordinator = yield* DeckWriteCoordinatorService;
    const derivationGenerationLocks = new Set<string>();

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
      readonly sessionId: number;
      readonly chunkId: number;
      readonly sequenceOrder: number;
      readonly topics: ReadonlyArray<string>;
    }): Effect.Effect<void> =>
      appEventPublisher
        .publish(ForgeTopicChunkExtracted, {
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

    const publishSynthesisTopicsExtractedBestEffort = (payload: {
      readonly sessionId: number;
    }): Effect.Effect<void> =>
      appEventPublisher
        .publish(ForgeSynthesisTopicsExtracted, {
          sessionId: payload.sessionId,
        })
        .pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error("[forge/topics] failed to publish synthesis event", {
                sessionId: payload.sessionId,
                error: toErrorMessage(error),
              });
            }),
          ),
          Effect.asVoid,
        );

    const withDerivationGenerationLock = <A, E>(input: {
      readonly parent: DerivationParentRef;
      readonly kind: DerivationKind;
      readonly effect: Effect.Effect<A, E>;
    }): Effect.Effect<A, E | ForgeDerivationAlreadyGeneratingError> =>
      Effect.suspend((): Effect.Effect<A, E | ForgeDerivationAlreadyGeneratingError> => {
        const lockKey = toDerivationLockKey(input.parent, input.kind);
        if (derivationGenerationLocks.has(lockKey)) {
          return Effect.fail(
            new ForgeDerivationAlreadyGeneratingError({
              parent: input.parent,
              kind: input.kind,
            }),
          );
        }

        derivationGenerationLocks.add(lockKey);
        return input.effect.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              derivationGenerationLocks.delete(lockKey);
            }),
          ),
        );
      });

    const loadDerivationById = (derivationId: number) =>
      mapOperationError(forgeSessionRepository.getDerivationById(derivationId)).pipe(
        Effect.flatMap((derivation) => ensureDerivationExists(derivation, derivationId)),
      );

    const loadRootTopicForCard = (rootCard: ForgeCardWithTopicContext) =>
      mapSessionRepositoryError(
        rootCard.sessionId,
        forgeSessionRepository.getTopicById(rootCard.topicId),
      ).pipe(
        Effect.flatMap((topic) =>
          topic === null
            ? Effect.fail(
                new ForgeOperationError({
                  message: `Root topic ${rootCard.topicId} for card ${rootCard.id} was not found.`,
                }),
              )
            : Effect.succeed(topic),
        ),
      );

    const loadResolvedDerivationParent = (parent: DerivationParentRef) =>
      Effect.gen(function* () {
        if (isCardParentRef(parent)) {
          const card = yield* forgeSessionRepository.getCardById(parent.cardId).pipe(
            Effect.mapError(toForgeOperationError),
            Effect.flatMap((resolvedCard) => ensureCardExists(resolvedCard, parent.cardId)),
          );

          return {
            parent,
            question: card.question,
            answer: card.answer,
            rootCard: card,
            sessionId: card.sessionId,
            derivation: null,
          };
        }

        const derivation = yield* loadDerivationById(parent.derivationId);
        const rootCard = yield* forgeSessionRepository.getCardById(derivation.rootCardId).pipe(
          Effect.mapError(toForgeOperationError),
          Effect.flatMap((resolvedCard) => ensureCardExists(resolvedCard, derivation.rootCardId)),
        );

        return {
          parent,
          question: derivation.question,
          answer: derivation.answer,
          rootCard,
          sessionId: rootCard.sessionId,
          derivation,
        };
      });

    const countDeletedDerivationsForReplacement = (input: {
      readonly sessionId: number;
      readonly parent: DerivationParentRef;
      readonly kind: DerivationKind;
    }) =>
      mapSessionRepositoryError(
        input.sessionId,
        forgeSessionRepository.getDescendantCountForParent({
          parent: input.parent,
          kind: input.kind,
        }),
      );

    type ResolvedDerivationParent = {
      readonly parent: DerivationParentRef;
      readonly question: string;
      readonly answer: string;
      readonly rootCard: ForgeCardWithTopicContext;
      readonly sessionId: number;
      readonly derivation: ForgeCardDerivation | null;
    };

    const buildExpansionAncestryChain = (input: {
      readonly resolvedParent: ResolvedDerivationParent;
    }) =>
      Effect.gen(function* () {
        const chain: Array<{
          readonly selectedCard: { readonly question: string; readonly answer: string };
          readonly siblingCards: ReadonlyArray<{
            readonly question: string;
            readonly answer: string;
          }>;
          readonly instruction?: string;
        }> = [];

        let selection:
          | { readonly kind: "card"; readonly card: ForgeCardWithTopicContext }
          | { readonly kind: "derivation"; readonly derivation: ForgeCardDerivation } =
          input.resolvedParent.derivation === null
            ? { kind: "card", card: input.resolvedParent.rootCard }
            : { kind: "derivation", derivation: input.resolvedParent.derivation };

        while (true) {
          if (selection.kind === "card") {
            const selectedCardId = selection.card.id;
            const topicCards = yield* mapSessionRepositoryError(
              selection.card.sessionId,
              forgeSessionRepository.getCardsForTopicId(selection.card.topicId),
            );

            if (!topicCards) {
              return yield* Effect.fail(
                new ForgeCardNotFoundError({
                  sourceCardId: selection.card.id,
                }),
              );
            }

            chain.push({
              selectedCard: {
                question: selection.card.question,
                answer: selection.card.answer,
              },
              siblingCards: topicCards.cards
                .filter((card) => card.id !== selectedCardId)
                .map((card) => ({
                  question: card.question,
                  answer: card.answer,
                })),
            });
            break;
          }

          const currentDerivation = selection.derivation;
          const siblingsParent =
            currentDerivation.parentDerivationId === null
              ? ({ cardId: currentDerivation.rootCardId } as const)
              : ({ derivationId: currentDerivation.parentDerivationId } as const);
          const siblings = yield* mapSessionRepositoryError(
            input.resolvedParent.sessionId,
            forgeSessionRepository.getDerivedCards({
              parent: siblingsParent,
              kind: "expansion",
            }),
          );

          chain.push({
            selectedCard: {
              question: currentDerivation.question,
              answer: currentDerivation.answer,
            },
            siblingCards: siblings
              .filter((derivation) => derivation.id !== currentDerivation.id)
              .map((derivation) => ({
                question: derivation.question,
                answer: derivation.answer,
              })),
            ...(currentDerivation.instruction
              ? { instruction: currentDerivation.instruction }
              : {}),
          });

          if (currentDerivation.parentDerivationId === null) {
            selection = {
              kind: "card",
              card: input.resolvedParent.rootCard,
            };
            continue;
          }

          const parentDerivation = yield* loadDerivationById(currentDerivation.parentDerivationId);
          selection = {
            kind: "derivation",
            derivation: parentDerivation,
          };
        }

        return chain.reverse();
      });

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

    const chunkResolvedSource = (resolvedSource: ResolvedForgeSourceContent) =>
      Effect.gen(function* () {
        const chunkResult = yield* chunkService.chunkText({
          text: resolvedSource.text,
          pageBreaks: resolvedSource.pageBreaks,
        });

        return {
          resolvedSource,
          chunkResult,
        };
      });

    const toExtractionResult = (
      sessionId: number,
      resolvedSource: ResolvedForgeSourceContent,
      chunkCount: number,
    ) => ({
      sessionId,
      textLength: resolvedSource.text.length,
      preview: resolvedSource.text.slice(0, PREVIEW_LENGTH),
      totalPages: resolvedSource.totalPages,
      chunkCount,
    });

    const createSessionFromSource = (source: ForgeSourceInput) =>
      Effect.gen(function* () {
        const resolvedSource = yield* mapSourceResolverErrorForSession(
          undefined,
          forgeSourceResolver.resolveMetadata(source),
        );

        const duplicateSession = yield* mapOperationError(
          forgeSessionRepository.findLatestBySourceFingerprint({
            sourceKind: resolvedSource.sourceKind,
            sourceFingerprint: resolvedSource.sourceFingerprint,
          }),
        );

        const session = yield* mapOperationError(
          forgeSessionRepository.createSession({
            sourceKind: resolvedSource.sourceKind,
            sourceLabel: resolvedSource.sourceLabel,
            sourceFilePath: resolvedSource.sourceFilePath,
            deckPath: null,
            sourceFingerprint: resolvedSource.sourceFingerprint,
          }),
        );

        return {
          session,
          duplicateOfSessionId: duplicateSession?.id ?? null,
        };
      });

    const resolveAndChunkSourceForSession = (session: ForgeSession, source: ForgeSourceInput) =>
      mapSourceResolverErrorForSession(session.id, forgeSourceResolver.resolveContent(source)).pipe(
        Effect.flatMap((resolvedSource) => ensureSessionSourceMatches(session, resolvedSource)),
        Effect.flatMap((resolvedSource) => chunkResolvedSource(resolvedSource)),
        Effect.map(({ resolvedSource, chunkResult }) => ({
          resolvedSource,
          chunkResult,
          extraction: toExtractionResult(session.id, resolvedSource, chunkResult.chunkCount),
        })),
      );

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

    const toTopicSummary = (input: {
      readonly sessionId: number;
      readonly topicId: number;
      readonly family: "detail" | "synthesis";
      readonly chunkId: number | null;
      readonly sequenceOrder: number | null;
      readonly topicIndex: number;
      readonly topicText: string;
      readonly selected: boolean;
    }) => ({
      topicId: input.topicId,
      sessionId: input.sessionId,
      family: input.family,
      chunkId: input.chunkId,
      chunkSequenceOrder: input.sequenceOrder,
      topicIndex: input.topicIndex,
      topicText: input.topicText,
      selected: input.selected,
    });

    const toTopicCardsSummary = (input: {
      readonly sessionId: number;
      readonly topicId: number;
      readonly family: "detail" | "synthesis";
      readonly chunkId: number | null;
      readonly sequenceOrder: number | null;
      readonly topicIndex: number;
      readonly topicText: string;
      readonly status: "idle" | "generating" | "generated" | "error";
      readonly errorMessage: string | null;
      readonly cardCount: number;
      readonly addedCount: number;
      readonly generationRevision: number;
      readonly selected: boolean;
    }) => ({
      topicId: input.topicId,
      sessionId: input.sessionId,
      family: input.family,
      chunkId: input.chunkId,
      chunkSequenceOrder: input.sequenceOrder,
      topicIndex: input.topicIndex,
      topicText: input.topicText,
      status: input.status,
      errorMessage: input.errorMessage,
      cardCount: input.cardCount,
      addedCount: input.addedCount,
      generationRevision: input.generationRevision,
      selected: input.selected,
    });

    const toTopicGroups = (
      topics: ReadonlyArray<
        ReturnType<typeof toTopicSummary> | ReturnType<typeof toTopicCardsSummary>
      >,
    ): ReadonlyArray<{
      readonly groupId: string;
      readonly groupKind: "chunk" | "section";
      readonly family: "detail" | "synthesis";
      readonly title: string;
      readonly displayOrder: number;
      readonly chunkId: number | null;
      readonly topics: ReadonlyArray<
        ReturnType<typeof toTopicSummary> | ReturnType<typeof toTopicCardsSummary>
      >;
    }> => {
      const detailGroups = new Map<
        number,
        {
          readonly chunkId: number;
          readonly displayOrder: number;
          readonly topics: Array<
            ReturnType<typeof toTopicSummary> | ReturnType<typeof toTopicCardsSummary>
          >;
        }
      >();
      const synthesisTopics: Array<
        ReturnType<typeof toTopicSummary> | ReturnType<typeof toTopicCardsSummary>
      > = [];

      for (const topic of topics) {
        if (topic.family === "synthesis") {
          synthesisTopics.push(topic);
          continue;
        }
        if (topic.chunkId === null || topic.chunkSequenceOrder === null) continue;

        const existing = detailGroups.get(topic.chunkId);
        if (existing) {
          existing.topics.push(topic);
          continue;
        }

        detailGroups.set(topic.chunkId, {
          chunkId: topic.chunkId,
          displayOrder: topic.chunkSequenceOrder,
          topics: [topic],
        });
      }

      const groups: Array<{
        readonly groupId: string;
        readonly groupKind: "chunk" | "section";
        readonly family: "detail" | "synthesis";
        readonly title: string;
        readonly displayOrder: number;
        readonly chunkId: number | null;
        readonly topics: ReadonlyArray<
          ReturnType<typeof toTopicSummary> | ReturnType<typeof toTopicCardsSummary>
        >;
      }> = Array.from(detailGroups.values())
        .sort(
          (left, right) => left.displayOrder - right.displayOrder || left.chunkId - right.chunkId,
        )
        .map((group) => ({
          groupId: `chunk:${group.chunkId}`,
          groupKind: "chunk" as const,
          family: "detail" as const,
          title: `Chunk ${group.displayOrder + 1}`,
          displayOrder: group.displayOrder,
          chunkId: group.chunkId,
          topics: group.topics
            .slice()
            .sort(
              (left, right) => left.topicIndex - right.topicIndex || left.topicId - right.topicId,
            ),
        }));

      if (synthesisTopics.length > 0) {
        groups.push({
          groupId: "section:synthesis",
          groupKind: "section" as const,
          family: "synthesis" as const,
          title: "Synthesis",
          displayOrder: (groups[groups.length - 1]?.displayOrder ?? -1) + 1,
          chunkId: null,
          topics: synthesisTopics
            .slice()
            .sort(
              (left, right) => left.topicIndex - right.topicIndex || left.topicId - right.topicId,
            ),
        });
      }

      return groups;
    };

    const loadCardsSnapshotRowsForSession = (sessionId: number, recoverStale = true) =>
      Effect.gen(function* () {
        yield* mapSessionRepositoryError(
          sessionId,
          forgeSessionRepository.getSession(sessionId),
        ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

        if (recoverStale) {
          yield* recoverStaleGeneratingTopics(sessionId);
        }

        return yield* mapSessionRepositoryError(
          sessionId,
          forgeSessionRepository.getCardsSnapshotBySession(sessionId),
        );
      });

    const loadTopicById = (sessionId: number, topicId: number) =>
      mapSessionRepositoryError(sessionId, forgeSessionRepository.getTopicById(topicId)).pipe(
        Effect.flatMap((topic) =>
          topic === null || topic.sessionId !== sessionId
            ? Effect.fail(new ForgeTopicNotFoundError({ sessionId, topicId }))
            : Effect.succeed(topic),
        ),
      );

    const loadExtractionOutcomes = (sessionId: number) =>
      mapSessionRepositoryError(
        sessionId,
        forgeSessionRepository.getTopicExtractionOutcomes(sessionId),
      ).pipe(
        Effect.map((outcomes) =>
          outcomes.map((outcome) => ({
            family: outcome.family,
            status: outcome.status,
            errorMessage: outcome.errorMessage,
          })),
        ),
      );

    const runDetailExtractionBranch = (input: {
      readonly sessionId: number;
      readonly chunks: ReadonlyArray<{
        readonly id: number;
        readonly text: string;
        readonly sequenceOrder: number;
      }>;
      readonly model: string | undefined;
    }) =>
      Effect.gen(function* () {
        const writes = yield* Effect.forEach(
          input.chunks,
          (chunk) =>
            forgePromptRuntime
              .run(
                GetTopicsPromptSpec,
                {
                  chunkText: chunk.text,
                },
                input.model ? { model: input.model } : undefined,
              )
              .pipe(
                Effect.map((result) => ({
                  chunkId: chunk.id,
                  sequenceOrder: chunk.sequenceOrder,
                  topics: result.output.topics,
                })),
                Effect.mapError(
                  (error) =>
                    new ForgeTopicExtractionError({
                      sessionId: input.sessionId,
                      chunkId: chunk.id,
                      sequenceOrder: chunk.sequenceOrder,
                      message:
                        error._tag === "PromptModelInvocationError"
                          ? `Model invocation failed for ${error.model}: ${toErrorMessage(error.cause)}`
                          : toErrorMessage(error),
                    }),
                ),
              ),
          { concurrency: MAX_REQUEST_CONCURRENCY },
        );

        yield* mapSessionRepositoryError(
          input.sessionId,
          forgeSessionRepository.replaceTopicsForSessionAndSetExtractionOutcome({
            sessionId: input.sessionId,
            writes: writes.map((write) => ({
              sequenceOrder: write.sequenceOrder,
              topics: write.topics,
            })),
            status: "extracted",
            errorMessage: null,
          }),
        );

        yield* Effect.forEach(
          writes,
          (write) =>
            publishChunkExtractedBestEffort({
              sessionId: input.sessionId,
              chunkId: write.chunkId,
              sequenceOrder: write.sequenceOrder,
              topics: write.topics,
            }),
          { discard: true },
        );

        return {
          family: "detail" as const,
          status: "extracted" as const,
          errorMessage: null,
        };
      }).pipe(
        Effect.catchTags({
          topic_extraction_error: (error) =>
            mapSessionRepositoryError(
              input.sessionId,
              forgeSessionRepository.replaceTopicsForSessionAndSetExtractionOutcome({
                sessionId: input.sessionId,
                writes: [],
                status: "error",
                errorMessage: error.message,
              }),
            ).pipe(
              Effect.as({
                family: "detail" as const,
                status: "error" as const,
                errorMessage: error.message,
              }),
            ),
        }),
      );

    const runSynthesisExtractionBranch = (input: {
      readonly sessionId: number;
      readonly sourceText: string;
      readonly model: string | undefined;
    }) =>
      forgePromptRuntime
        .run(
          GetSynthesisTopicsPromptSpec,
          {
            sourceText: input.sourceText,
          },
          input.model ? { model: input.model } : undefined,
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new ForgeTopicExtractionError({
                sessionId: input.sessionId,
                message:
                  error._tag === "PromptModelInvocationError"
                    ? `Model invocation failed for ${error.model}: ${toErrorMessage(error.cause)}`
                    : toErrorMessage(error),
              }),
          ),
          Effect.flatMap((result) =>
            mapSessionRepositoryError(
              input.sessionId,
              forgeSessionRepository.replaceSynthesisTopicsForSessionAndSetExtractionOutcome({
                sessionId: input.sessionId,
                topics: result.output.topics,
                status: "extracted",
                errorMessage: null,
              }),
            ).pipe(
              Effect.zipRight(
                publishSynthesisTopicsExtractedBestEffort({
                  sessionId: input.sessionId,
                }),
              ),
            ),
          ),
          Effect.as({
            family: "synthesis" as const,
            status: "extracted" as const,
            errorMessage: null,
          }),
          Effect.catchTag("topic_extraction_error", (error) =>
            mapSessionRepositoryError(
              input.sessionId,
              forgeSessionRepository.replaceSynthesisTopicsForSessionAndSetExtractionOutcome({
                sessionId: input.sessionId,
                topics: [],
                status: "error",
                errorMessage: error.message,
              }),
            ).pipe(
              Effect.as({
                family: "synthesis" as const,
                status: "error" as const,
                errorMessage: error.message,
              }),
            ),
          ),
        );

    const startTopicExtractionCanonical = (input: {
      readonly source: ForgeSourceInput;
      readonly model: string | undefined;
    }) =>
      createSessionFromSource(input.source).pipe(
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

            yield* appEventPublisher
              .publish(ForgeExtractionSessionCreated, { sessionId: session.id })
              .pipe(
                Effect.catchAll((error) =>
                  Effect.sync(() => {
                    console.error("[forge/start] failed to publish session created event", {
                      sessionId: session.id,
                      error: toErrorMessage(error),
                    });
                  }),
                ),
                Effect.asVoid,
              );

            const extractedAndChunked = yield* resolveAndChunkSourceForSession(
              session,
              input.source,
            );

            yield* mapSessionRepositoryError(
              session.id,
              forgeSessionRepository.saveChunks(session.id, extractedAndChunked.chunkResult.chunks),
            );

            yield* mapSessionRepositoryError(
              session.id,
              forgeSessionRepository.clearTopicExtractionOutcomes(session.id),
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

            const outcomes = yield* Effect.all(
              [
                runDetailExtractionBranch({
                  sessionId: session.id,
                  chunks: chunks.map((chunk) => ({
                    id: chunk.id,
                    text: chunk.text,
                    sequenceOrder: chunk.sequenceOrder,
                  })),
                  model: input.model,
                }),
                runSynthesisExtractionBranch({
                  sessionId: session.id,
                  sourceText: extractedAndChunked.resolvedSource.text,
                  model: input.model,
                }),
              ],
              { concurrency: "unbounded" },
            );

            const successCount = outcomes.filter(
              (outcome) => outcome.status === "extracted",
            ).length;
            const finalStatus = successCount > 0 ? "topics_extracted" : "error";
            const finalErrorMessage =
              finalStatus === "error"
                ? outcomes
                    .filter((outcome) => outcome.errorMessage !== null)
                    .map((outcome) => outcome.errorMessage)
                    .join(" | ") || "Topic extraction failed."
                : null;

            yield* mapSessionRepositoryStatusUpdateError(
              session.id,
              forgeSessionRepository.setSessionStatus({
                sessionId: session.id,
                status: finalStatus,
                errorMessage: finalErrorMessage,
              }),
            ).pipe(Effect.flatMap((current) => ensureSessionExistsForStart(current, session.id)));

            if (finalStatus === "error") {
              return yield* Effect.fail(
                new ForgeTopicExtractionError({
                  sessionId: session.id,
                  message: finalErrorMessage ?? "Topic extraction failed.",
                }),
              );
            }

            const finalSession = yield* mapSessionRepositoryError(
              session.id,
              forgeSessionRepository.getSession(session.id),
            ).pipe(Effect.flatMap((current) => ensureSessionExistsForStart(current, session.id)));

            const topics = yield* mapSessionRepositoryError(
              session.id,
              forgeSessionRepository.getCardsSnapshotBySession(session.id),
            );
            const persistedOutcomes = yield* loadExtractionOutcomes(session.id);

            return {
              session: finalSession,
              duplicateOfSessionId,
              extraction: extractedAndChunked.extraction,
              outcomes: persistedOutcomes,
              groups: toTopicGroups(
                topics.map((topic) =>
                  toTopicSummary({
                    sessionId: topic.sessionId,
                    topicId: topic.topicId,
                    family: topic.family,
                    chunkId: topic.chunkId,
                    sequenceOrder: topic.sequenceOrder,
                    topicIndex: topic.topicIndex,
                    topicText: topic.topicText,
                    selected: topic.selected,
                  }),
                ),
              ),
            };
          }).pipe(
            Effect.tapErrorCause((cause) =>
              setSessionErrorBestEffort(
                session.id,
                toFailureMessageFromCause(cause),
                "[forge/start]",
              ),
            ),
          ),
        ),
      );

    const generateTopicCardsForTopicId = (input: {
      readonly sessionId: number;
      readonly topicId: number;
      readonly instruction: string | undefined;
      readonly model: string | undefined;
    }) =>
      Effect.gen(function* () {
        const topic = yield* loadTopicById(input.sessionId, input.topicId);
        let generationFinishedSuccessfully = false;

        const generationEffect = Effect.gen(function* () {
          yield* forgeSessionRepository.tryStartTopicGeneration(topic.topicId).pipe(
            Effect.catchTag("ForgeTopicAlreadyGeneratingRepositoryError", () =>
              Effect.fail(
                new ForgeTopicAlreadyGeneratingError({
                  sessionId: input.sessionId,
                  topicId: input.topicId,
                }),
              ),
            ),
            Effect.catchTag("ForgeSessionRepositoryError", (error) =>
              Effect.fail(toSessionOperationErrorFromRepositoryError(input.sessionId, error)),
            ),
          );

          const contextText = yield* topicGroundingTextResolver
            .resolveForTopic(topic)
            .pipe(
              Effect.mapError((error) =>
                toSessionOperationErrorFromRepositoryError(input.sessionId, error),
              ),
            );

          const promptResult =
            topic.family === "detail"
              ? yield* forgePromptRuntime
                  .run(
                    CreateCardsPromptSpec,
                    {
                      contextText,
                      topic: topic.topicText,
                      ...(input.instruction ? { instruction: input.instruction } : {}),
                    },
                    input.model ? { model: input.model } : undefined,
                  )
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new ForgeCardGenerationError({
                          sessionId: input.sessionId,
                          topicId: input.topicId,
                          message: toErrorMessage(error),
                        }),
                    ),
                  )
              : yield* forgePromptRuntime
                  .run(
                    CreateSynthesisCardsPromptSpec,
                    {
                      contextText,
                      topic: topic.topicText,
                      ...(input.instruction ? { instruction: input.instruction } : {}),
                    },
                    input.model ? { model: input.model } : undefined,
                  )
                  .pipe(
                    Effect.mapError(
                      (error) =>
                        new ForgeCardGenerationError({
                          sessionId: input.sessionId,
                          topicId: input.topicId,
                          message: toErrorMessage(error),
                        }),
                    ),
                  );

          yield* mapSessionRepositoryError(
            input.sessionId,
            forgeSessionRepository.replaceCardsForTopicAndFinishGenerationSuccess({
              topicId: topic.topicId,
              cards: promptResult.output.cards,
            }),
          );
          generationFinishedSuccessfully = true;

          const result = yield* mapSessionRepositoryError(
            input.sessionId,
            forgeSessionRepository.getCardsForTopicId(topic.topicId),
          );
          if (!result) {
            return yield* Effect.fail(
              new ForgeTopicNotFoundError({
                sessionId: input.sessionId,
                topicId: input.topicId,
              }),
            );
          }

          return {
            topic: toTopicCardsSummary({
              sessionId: result.topic.sessionId,
              topicId: result.topic.topicId,
              family: result.topic.family,
              chunkId: result.topic.chunkId,
              sequenceOrder: result.topic.sequenceOrder,
              topicIndex: result.topic.topicIndex,
              topicText: result.topic.topicText,
              status: result.topic.status,
              errorMessage: result.topic.errorMessage,
              cardCount: result.topic.cardCount,
              addedCount: result.topic.addedCount,
              generationRevision: result.topic.generationRevision,
              selected: result.topic.selected,
            }),
            cards: result.cards.map((card) => ({
              id: card.id,
              question: card.question,
              answer: card.answer,
              addedToDeck: card.addedToDeck,
            })),
          };
        });

        return yield* generationEffect.pipe(
          Effect.tapErrorCause((cause) =>
            generationFinishedSuccessfully
              ? Effect.void
              : setTopicGenerationErrorBestEffort({
                  topicId: topic.topicId,
                  sessionId: topic.sessionId,
                  message: toFailureMessageFromCause(cause),
                  logContext: "[forge/cards]",
                }),
          ),
        );
      });

    const handlers: Pick<Implementations<AppContract, never>, ForgeHandlerKeys> = {
      ForgeCreateSession: ({ source }) => createSessionFromSource(source),
      ForgeListSessions: () =>
        mapOperationError(forgeSessionRepository.listRecentSessions()).pipe(
          Effect.map((sessions) => ({ sessions })),
        ),
      ForgeExtractText: ({ sessionId, source }) =>
        Effect.gen(function* () {
          const existingSession = yield* mapOperationError(
            forgeSessionRepository.getSession(sessionId),
          ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

          const alreadyHasChunks = yield* mapOperationError(
            forgeSessionRepository.hasChunks(sessionId),
          );

          if (existingSession.status === "extracting") {
            return yield* Effect.fail(
              new ForgeSessionBusyError({
                sessionId,
                status: existingSession.status,
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

          if (existingSession.status !== "created") {
            return yield* Effect.fail(
              new ForgeOperationError({
                message: `Session ${sessionId} cannot begin extraction from status ${existingSession.status}.`,
              }),
            );
          }

          yield* mapSourceResolverErrorForSession(
            sessionId,
            forgeSourceResolver.resolveMetadata(source),
          ).pipe(
            Effect.flatMap((resolved) => ensureSessionSourceMatches(existingSession, resolved)),
          );

          const beganExtraction = yield* mapOperationError(
            forgeSessionRepository.tryBeginExtraction(sessionId),
          );

          if (beganExtraction === null) {
            return yield* failBeginExtractionConflict(sessionId);
          }

          const extractionEffect = Effect.gen(function* () {
            const resolvedSource = yield* mapSourceResolverErrorForSession(
              sessionId,
              forgeSourceResolver.resolveContent(source),
            ).pipe(
              Effect.flatMap((resolved) => ensureSessionSourceMatches(existingSession, resolved)),
            );

            const extractedAndChunked = yield* chunkResolvedSource(resolvedSource).pipe(
              Effect.map(({ chunkResult }) => ({
                chunkResult,
                extraction: toExtractionResult(sessionId, resolvedSource, chunkResult.chunkCount),
              })),
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
            Effect.tapErrorCause((cause) =>
              setSessionErrorBestEffort(
                sessionId,
                toFailureMessageFromCause(cause),
                "[forge/extract]",
              ),
            ),
          );
        }),
      ForgePreviewChunks: ({ source }) =>
        mapSourceResolverErrorForPreview(forgeSourceResolver.resolveContent(source)).pipe(
          Effect.flatMap((resolvedSource) => chunkResolvedSource(resolvedSource)),
          Effect.map(({ resolvedSource, chunkResult }) => ({
            textLength: resolvedSource.text.length,
            totalPages: resolvedSource.totalPages,
            chunkCount: chunkResult.chunkCount,
          })),
        ),
      ForgeGetTopicExtractionSnapshot: ({ sessionId }) =>
        Effect.gen(function* () {
          const session = yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getSession(sessionId),
          ).pipe(Effect.flatMap((s) => ensureSessionExists(s, sessionId)));

          const topics = yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getCardsSnapshotBySession(sessionId),
          );
          const outcomes = yield* loadExtractionOutcomes(sessionId);

          return {
            session,
            outcomes,
            groups: toTopicGroups(
              topics.map((row) =>
                toTopicSummary({
                  sessionId: row.sessionId,
                  topicId: row.topicId,
                  family: row.family,
                  chunkId: row.chunkId,
                  sequenceOrder: row.sequenceOrder,
                  topicIndex: row.topicIndex,
                  topicText: row.topicText,
                  selected: row.selected,
                }),
              ),
            ),
          };
        }),
      ForgeGetCardsSnapshot: ({ sessionId }) =>
        Effect.gen(function* () {
          const topics = yield* loadCardsSnapshotRowsForSession(sessionId);

          return {
            topics: topics.map((row) =>
              toTopicCardsSummary({
                sessionId: row.sessionId,
                topicId: row.topicId,
                family: row.family,
                chunkId: row.chunkId,
                sequenceOrder: row.sequenceOrder,
                topicIndex: row.topicIndex,
                topicText: row.topicText,
                status: row.status,
                errorMessage: row.errorMessage,
                cardCount: row.cardCount,
                addedCount: row.addedCount,
                generationRevision: row.generationRevision,
                selected: row.selected,
              }),
            ),
          };
        }),
      ForgeGetTopicCards: ({ sessionId, topicId }) =>
        Effect.gen(function* () {
          yield* loadTopicById(sessionId, topicId);
          const result = yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getCardsForTopicId(topicId),
          );

          if (!result) {
            return yield* Effect.fail(new ForgeTopicNotFoundError({ sessionId, topicId }));
          }

          return {
            topic: toTopicCardsSummary({
              sessionId: result.topic.sessionId,
              topicId: result.topic.topicId,
              family: result.topic.family,
              chunkId: result.topic.chunkId,
              sequenceOrder: result.topic.sequenceOrder,
              topicIndex: result.topic.topicIndex,
              topicText: result.topic.topicText,
              status: result.topic.status,
              errorMessage: result.topic.errorMessage,
              cardCount: result.topic.cardCount,
              addedCount: result.topic.addedCount,
              generationRevision: result.topic.generationRevision,
              selected: result.topic.selected,
            }),
            cards: result.cards.map((card) => ({
              id: card.id,
              question: card.question,
              answer: card.answer,
              addedToDeck: card.addedToDeck,
            })),
          };
        }),
      ForgeGenerateTopicCards: ({ sessionId, topicId, instruction, model }) =>
        generateTopicCardsForTopicId({
          sessionId,
          topicId,
          instruction,
          model,
        }),
      ForgeGenerateSelectedTopicCards: ({
        sessionId,
        topicIds,
        instruction,
        model,
        concurrencyLimit,
      }) =>
        Effect.gen(function* () {
          yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getSession(sessionId),
          ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

          yield* recoverStaleGeneratingTopics(sessionId);
          const dedupedTopicIds = Array.from(new Set(topicIds));

          const boundedConcurrency = Math.max(
            1,
            Math.min(
              concurrencyLimit ?? DEFAULT_TOPIC_GENERATION_BATCH_CONCURRENCY,
              MAX_REQUEST_CONCURRENCY,
            ),
          );

          const results = yield* Effect.forEach(
            dedupedTopicIds,
            (topicId) =>
              generateTopicCardsForTopicId({
                sessionId,
                topicId,
                instruction,
                model,
              }).pipe(
                Effect.map(() => ({
                  topicId,
                  status: "generated" as const,
                  message: null,
                })),
                Effect.catchTags({
                  topic_already_generating: () =>
                    Effect.succeed({
                      topicId,
                      status: "already_generating" as const,
                      message: null,
                    }),
                  topic_not_found: () =>
                    Effect.succeed({
                      topicId,
                      status: "topic_not_found" as const,
                      message: null,
                    }),
                  card_generation_error: (error) =>
                    Effect.succeed({
                      topicId,
                      status: "error" as const,
                      message: error.message,
                    }),
                  session_operation_error: (error) =>
                    Effect.succeed({
                      topicId,
                      status: "error" as const,
                      message: error.message,
                    }),
                }),
                Effect.catchAllCause((cause) =>
                  Effect.succeed({
                    topicId,
                    status: "error" as const,
                    message: toFailureMessageFromCause(cause),
                  }),
                ),
              ),
            { concurrency: boundedConcurrency },
          );

          return {
            sessionId,
            results,
          };
        }),
      ForgeGetDerivedCards: ({ parent, kind }) =>
        mapOperationError(
          forgeSessionRepository.getDerivedCards({
            parent,
            kind,
          }),
        ).pipe(
          Effect.map((derivations) => ({
            derivations: derivations.map((derivation) => ({
              id: derivation.id,
              rootCardId: derivation.rootCardId,
              parentDerivationId: derivation.parentDerivationId,
              kind: derivation.kind,
              derivationOrder: derivation.derivationOrder,
              question: derivation.question,
              answer: derivation.answer,
              instruction: derivation.instruction,
              addedCount: derivation.addedCount,
            })),
          })),
        ),
      ForgeGenerateDerivedCards: ({ parent, kind, instruction, model, confirmed }) =>
        withDerivationGenerationLock({
          parent,
          kind,
          effect: Effect.gen(function* () {
            const resolvedParent = yield* loadResolvedDerivationParent(parent);
            const normalizedInstruction = instruction?.trim() ? instruction.trim() : null;

            if (
              kind === "expansion" &&
              resolvedParent.derivation !== null &&
              resolvedParent.derivation.kind !== "expansion"
            ) {
              return yield* Effect.fail(
                new ForgeOperationError({
                  message:
                    "Expansion derivations can only be created from root cards or expansion derivations.",
                }),
              );
            }

            if (confirmed !== true) {
              const descendantCount = yield* countDeletedDerivationsForReplacement({
                sessionId: resolvedParent.sessionId,
                parent,
                kind,
              });

              if (descendantCount > 0) {
                return {
                  confirmRequired: true as const,
                  descendantCount,
                };
              }
            }

            const rootTopic = yield* loadRootTopicForCard(resolvedParent.rootCard);
            const contextText = yield* topicGroundingTextResolver
              .resolveForTopic(rootTopic)
              .pipe(
                Effect.mapError((error) =>
                  toSessionOperationErrorFromRepositoryError(resolvedParent.sessionId, error),
                ),
              );

            const cards =
              kind === "permutation"
                ? (yield* forgePromptRuntime
                    .run(
                      GeneratePermutationsPromptSpec,
                      {
                        contextText,
                        source: {
                          question: resolvedParent.question,
                          answer: resolvedParent.answer,
                        },
                        ...(normalizedInstruction ? { instruction: normalizedInstruction } : {}),
                      },
                      model ? { model } : undefined,
                    )
                    .pipe(
                      Effect.mapError(
                        (error) =>
                          new ForgeDerivationGenerationError({
                            parent,
                            kind,
                            message: toErrorMessage(error),
                          }),
                      ),
                    )).output.permutations
                : (yield* forgePromptRuntime
                    .run(
                      GenerateExpansionsPromptSpec,
                      {
                        contextText,
                        topic: rootTopic.topicText,
                        ancestryChain: yield* buildExpansionAncestryChain({
                          resolvedParent,
                        }),
                        ...(normalizedInstruction ? { instruction: normalizedInstruction } : {}),
                      },
                      model ? { model } : undefined,
                    )
                    .pipe(
                      Effect.mapError(
                        (error) =>
                          new ForgeDerivationGenerationError({
                            parent,
                            kind,
                            message: toErrorMessage(error),
                          }),
                      ),
                    )).output.cards;

            yield* mapSessionRepositoryError(
              resolvedParent.sessionId,
              forgeSessionRepository.replaceDerivedCards({
                parent,
                kind,
                rootCardId: resolvedParent.rootCard.id,
                instruction: normalizedInstruction,
                cards,
              }),
            );

            const derivations = yield* mapSessionRepositoryError(
              resolvedParent.sessionId,
              forgeSessionRepository.getDerivedCards({
                parent,
                kind,
              }),
            );

            return {
              derivations: derivations.map((derivation) => ({
                id: derivation.id,
                rootCardId: derivation.rootCardId,
                parentDerivationId: derivation.parentDerivationId,
                kind: derivation.kind,
                derivationOrder: derivation.derivationOrder,
                question: derivation.question,
                answer: derivation.answer,
                instruction: derivation.instruction,
                addedCount: derivation.addedCount,
              })),
            };
          }),
        }),
      ForgeGetCardCloze: ({ source }) =>
        Effect.gen(function* () {
          const resolvedParent = yield* loadResolvedDerivationParent(source);
          const cloze = yield* mapSessionRepositoryError(
            resolvedParent.sessionId,
            forgeSessionRepository.getClozeForSource(source),
          );

          return {
            source,
            cloze: cloze?.clozeText ?? null,
            addedCount: cloze?.addedCount ?? 0,
          };
        }),
      ForgeGenerateCardCloze: ({ source, sourceQuestion, sourceAnswer, instruction, model }) =>
        Effect.gen(function* () {
          const resolvedParent = yield* loadResolvedDerivationParent(source);
          const currentSourceQuestion = sourceQuestion ?? resolvedParent.question;
          const currentSourceAnswer = sourceAnswer ?? resolvedParent.answer;
          const rootTopic = yield* loadRootTopicForCard(resolvedParent.rootCard);
          const contextText = yield* topicGroundingTextResolver
            .resolveForTopic(rootTopic)
            .pipe(
              Effect.mapError((error) =>
                toSessionOperationErrorFromRepositoryError(resolvedParent.sessionId, error),
              ),
            );

          const promptResult = yield* forgePromptRuntime
            .run(
              GenerateClozePromptSpec,
              {
                contextText,
                source: {
                  question: currentSourceQuestion,
                  answer: currentSourceAnswer,
                },
                ...(instruction ? { instruction } : {}),
              },
              model ? { model } : undefined,
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new ForgeClozeGenerationError({
                    source,
                    message: toErrorMessage(error),
                  }),
              ),
            );

          const cloze = yield* mapSessionRepositoryError(
            resolvedParent.sessionId,
            forgeSessionRepository.upsertClozeForSource({
              source,
              clozeText: promptResult.output.cloze,
            }),
          );

          return {
            source: cloze.source,
            cloze: cloze.clozeText,
            addedCount: cloze.addedCount,
          };
        }),
      ForgeReformulateCard: ({ source, sourceQuestion, sourceAnswer, model }) =>
        Effect.gen(function* () {
          const resolvedParent = yield* loadResolvedDerivationParent(source);
          const currentSourceQuestion = sourceQuestion ?? resolvedParent.question;
          const currentSourceAnswer = sourceAnswer ?? resolvedParent.answer;
          const rootTopic = yield* loadRootTopicForCard(resolvedParent.rootCard);
          const contextText = yield* topicGroundingTextResolver
            .resolveForTopic(rootTopic)
            .pipe(
              Effect.mapError((error) =>
                toSessionOperationErrorFromRepositoryError(resolvedParent.sessionId, error),
              ),
            );

          const promptResult = yield* forgePromptRuntime
            .run(
              ReformulateCardPromptSpec,
              {
                contextText,
                source: {
                  question: currentSourceQuestion,
                  answer: currentSourceAnswer,
                },
              },
              model ? { model } : undefined,
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new ForgeCardReformulationError({
                    source,
                    message: toErrorMessage(error),
                  }),
              ),
            );

          if (isCardParentRef(source)) {
            const updatedCard = yield* mapSessionRepositoryError(
              resolvedParent.sessionId,
              forgeSessionRepository.updateCardContent({
                cardId: source.cardId,
                question: promptResult.output.question,
                answer: promptResult.output.answer,
              }),
            );

            if (!updatedCard) {
              return yield* Effect.fail(
                new ForgeCardNotFoundError({
                  sourceCardId: source.cardId,
                }),
              );
            }

            return {
              source,
              card: {
                id: updatedCard.id,
                question: updatedCard.question,
                answer: updatedCard.answer,
                addedToDeck: updatedCard.addedToDeck,
              },
            };
          }

          const updatedDerivation = yield* mapSessionRepositoryError(
            resolvedParent.sessionId,
            forgeSessionRepository.updateDerivedCardContent({
              derivationId: source.derivationId,
              question: promptResult.output.question,
              answer: promptResult.output.answer,
            }),
          );

          if (!updatedDerivation) {
            return yield* Effect.fail(new ForgeDerivationNotFoundError(source));
          }

          return {
            source,
            derivation: {
              id: updatedDerivation.id,
              rootCardId: updatedDerivation.rootCardId,
              parentDerivationId: updatedDerivation.parentDerivationId,
              kind: updatedDerivation.kind,
              derivationOrder: updatedDerivation.derivationOrder,
              question: updatedDerivation.question,
              answer: updatedDerivation.answer,
              instruction: updatedDerivation.instruction,
              addedCount: updatedDerivation.addedCount,
            },
          };
        }),
      ForgeUpdateCard: ({ cardId, question, answer }) =>
        Effect.gen(function* () {
          const sourceCard = yield* forgeSessionRepository.getCardById(cardId).pipe(
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
              addedToDeck: updatedCard.addedToDeck,
            },
          };
        }),
      ForgeUpdateDerivation: ({ derivationId, question, answer }) =>
        Effect.gen(function* () {
          const updatedDerivation = yield* mapOperationError(
            forgeSessionRepository.updateDerivedCardContent({
              derivationId,
              question,
              answer,
            }),
          );

          if (!updatedDerivation) {
            return yield* Effect.fail(new ForgeDerivationNotFoundError({ derivationId }));
          }

          return {
            derivation: {
              id: updatedDerivation.id,
              rootCardId: updatedDerivation.rootCardId,
              parentDerivationId: updatedDerivation.parentDerivationId,
              kind: updatedDerivation.kind,
              derivationOrder: updatedDerivation.derivationOrder,
              question: updatedDerivation.question,
              answer: updatedDerivation.answer,
              instruction: updatedDerivation.instruction,
              addedCount: updatedDerivation.addedCount,
            },
          };
        }),
      ForgeStartTopicExtraction: ({ source, model }) =>
        startTopicExtractionCanonical({ source, model }),
      ForgeSaveTopicSelections: ({ sessionId, topicIds }) =>
        Effect.gen(function* () {
          yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.getSession(sessionId),
          ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

          yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.saveTopicSelectionsByTopicIds({
              sessionId,
              topicIds,
            }),
          );

          return {};
        }),
      ForgeSetSessionDeckPath: ({ sessionId, deckPath }) =>
        Effect.gen(function* () {
          yield* mapSessionRepositoryError(
            sessionId,
            forgeSessionRepository.setSessionDeckPath({ sessionId, deckPath }),
          ).pipe(Effect.flatMap((session) => ensureSessionExists(session, sessionId)));

          return {};
        }),
      ForgeAddCardToDeck: ({ deckPath, content, cardType, sourceCardId, derivationId }) =>
        Effect.gen(function* () {
          if (typeof sourceCardId === "number" && typeof derivationId === "number") {
            return yield* Effect.fail(
              new ForgeOperationError({
                message: "Provide either sourceCardId or derivationId, not both.",
              }),
            );
          }

          yield* validateDeckAccessAs(
            settingsRepository,
            deckPath,
            (m) => new ForgeOperationError({ message: m }),
          );

          const cardCount =
            cardType === "qa"
              ? yield* QAType.parse(content).pipe(Effect.map((p) => QAType.cards(p).length))
              : yield* ClozeType.parse(content).pipe(Effect.map((p) => ClozeType.cards(p).length));
          const itemType = cardType === "qa" ? QAType : ClozeType;
          const cards = Array.from({ length: cardCount }, () => createMetadata());

          const deckManager = yield* DeckManager;
          yield* deckWriteCoordinator.withDeckLock(
            deckPath,
            deckManager.appendItem(deckPath, { cards, content }, itemType),
          );

          if (typeof sourceCardId === "number" && cardType === "qa") {
            yield* forgeSessionRepository.markCardAddedToDeck(sourceCardId).pipe(
              Effect.catchTag("ForgeSessionRepositoryError", (error) =>
                Effect.sync(() => {
                  console.warn("[forge/cards] failed to persist card added marker", {
                    sourceCardId,
                    error: error.message,
                  });
                }),
              ),
              Effect.asVoid,
            );
          }

          if (typeof sourceCardId === "number" && cardType === "cloze") {
            yield* forgeSessionRepository
              .incrementClozeAddedCount({
                source: { cardId: sourceCardId },
                incrementBy: cardCount,
              })
              .pipe(
                Effect.catchTag("ForgeSessionRepositoryError", (error) =>
                  Effect.sync(() => {
                    console.warn("[forge/cards] failed to persist cloze added count", {
                      sourceCardId,
                      cardCount,
                      error: error.message,
                    });
                  }),
                ),
                Effect.asVoid,
              );
          }

          if (typeof derivationId === "number" && cardType === "qa") {
            yield* forgeSessionRepository
              .incrementDerivedCardAddedCount({
                derivationId,
                incrementBy: cardCount,
              })
              .pipe(
                Effect.catchTag("ForgeSessionRepositoryError", (error) =>
                  Effect.sync(() => {
                    console.warn("[forge/cards] failed to persist derivation added count", {
                      derivationId,
                      cardCount,
                      error: error.message,
                    });
                  }),
                ),
                Effect.asVoid,
              );
          }

          if (typeof derivationId === "number" && cardType === "cloze") {
            yield* forgeSessionRepository
              .incrementClozeAddedCount({
                source: { derivationId },
                incrementBy: cardCount,
              })
              .pipe(
                Effect.catchTag("ForgeSessionRepositoryError", (error) =>
                  Effect.sync(() => {
                    console.warn("[forge/cards] failed to persist cloze added count", {
                      derivationId,
                      cardCount,
                      error: error.message,
                    });
                  }),
                ),
                Effect.asVoid,
              );
          }

          return { cardIds: cards.map((card) => card.id) };
        }).pipe(Effect.provide(DeckManagerServicesLive), Effect.mapError(toForgeOperationError)),
    };

    return handlers;
  });
