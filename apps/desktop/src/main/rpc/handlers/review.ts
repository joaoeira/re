import path from "node:path";
import { randomUUID } from "node:crypto";

import { inferType } from "@re/core";
import { ClozeType, QAType, type QAContent } from "@re/types";
import {
  DeckManager,
  ReviewQueueBuilder,
  Scheduler,
  computeDueDate,
  resolveDeckImagePath,
} from "@re/workspace";
import { Path } from "@effect/platform";
import type { FileSystem } from "@effect/platform";
import { Effect, Exit } from "effect";
import type { Implementations } from "electron-effect-rpc/types";

import { toMetadataFingerprint } from "@main/analytics/fingerprint";
import { findCardLocationById } from "@main/card-location";
import {
  AnalyticsRepositoryService,
  DeckWriteCoordinatorService,
  ForgePromptRuntimeService,
  SettingsRepositoryService,
} from "@main/di";
import { GenerateReviewPermutationsPromptSpec } from "@main/review/prompts/generate-review-permutations";
import type { SettingsRepository } from "@main/settings/repository";
import { toErrorMessage } from "@main/utils/format";
import type { AppContract } from "@shared/rpc/contracts";
import { toDesktopAssetUrl } from "@shared/lib/asset-url";
import {
  CardContentIndexOutOfBoundsError,
  CardContentNotFoundError,
  CardContentParseError,
  CardContentReadError,
  ReviewAssistantUnsupportedCardTypeError,
  ReviewPermutationGenerationError,
  ReviewOperationError,
  UndoConflictError,
  UndoSafetyUnavailableError,
} from "@shared/rpc/schemas/review";

import {
  assertWithinRoot,
  canonicalizeWorkspacePath,
  provideHandlerServices,
  validateDeckAccess,
  validateDeckAccessAs,
  validateRequestedRootPathAs,
} from "./shared";

const reviewItemTypes = [QAType, ClozeType] as const;
const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;

type ReviewHandlerKeys =
  | "BuildReviewQueue"
  | "GetCardContent"
  | "GetReviewAssistantSourceCard"
  | "ReviewGeneratePermutations"
  | "ScheduleReview"
  | "UndoReview"
  | "GetReviewStats"
  | "ListReviewHistory";

type ReviewHandlerRuntime =
  | DeckManager
  | ReviewQueueBuilder
  | Scheduler
  | FileSystem.FileSystem
  | Path.Path;

const failWithReviewOperationError = (error: unknown) =>
  Effect.fail(new ReviewOperationError({ message: toErrorMessage(error) }));

type ReviewRenderedCardSpec = {
  readonly prompt: string;
  readonly reveal: string;
  readonly cardType: "qa" | "cloze";
};

type ResolvedReviewCard =
  | {
      readonly rootPath: string;
      readonly cardType: "qa";
      readonly cardSpec: ReviewRenderedCardSpec;
      readonly qaContent: QAContent;
    }
  | {
      readonly rootPath: string;
      readonly cardType: "cloze";
      readonly cardSpec: ReviewRenderedCardSpec;
    };

const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const rewriteSingleImageUrlForDesktop = (options: {
  readonly rootPath: string;
  readonly deckPath: string;
  readonly rawUrl: string;
}): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    const normalizedUrl = options.rawUrl.trim();

    if (normalizedUrl.length === 0) {
      return "";
    }

    if (URI_SCHEME_PATTERN.test(normalizedUrl) || normalizedUrl.startsWith("//")) {
      return normalizedUrl;
    }

    const resolved = yield* resolveDeckImagePath({
      rootPath: options.rootPath,
      deckPath: options.deckPath,
      imagePath: normalizedUrl,
    }).pipe(Effect.either);

    if (resolved._tag === "Left") {
      return "";
    }

    return toDesktopAssetUrl(resolved.right.workspaceRelativePath);
  });

const rewriteDeckImageUrlsForDesktop = (options: {
  readonly rootPath: string;
  readonly deckPath: string;
  readonly markdown: string;
}): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    let cursor = 0;
    let output = "";

    for (const match of options.markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
      const index = match.index ?? 0;
      const fullMatch = match[0] ?? "";
      const altText = match[1] ?? "";
      const rawUrl = match[2] ?? "";

      output += options.markdown.slice(cursor, index);
      const rewrittenUrl = yield* rewriteSingleImageUrlForDesktop({
        rootPath: options.rootPath,
        deckPath: options.deckPath,
        rawUrl,
      });
      output += `![${altText}](${rewrittenUrl})`;
      cursor = index + fullMatch.length;
    }

    output += options.markdown.slice(cursor);
    return output;
  });

const loadResolvedReviewCard = (options: {
  readonly settingsRepository: SettingsRepository;
  readonly deckPath: string;
  readonly cardId: string;
  readonly cardIndex: number;
}): Effect.Effect<
  ResolvedReviewCard,
  | CardContentReadError
  | CardContentNotFoundError
  | CardContentParseError
  | CardContentIndexOutOfBoundsError,
  DeckManager | Path.Path
> =>
  Effect.gen(function* () {
    const rootPath = yield* validateDeckAccess<CardContentReadError | CardContentNotFoundError>(
      options.settingsRepository,
      {
        deckPath: options.deckPath,
        mapSettingsError: (error) => new CardContentReadError({ message: toErrorMessage(error) }),
        makeMissingRootError: () =>
          new CardContentNotFoundError({
            message: "Workspace root path is not configured.",
          }),
        makeOutsideRootError: (invalidDeckPath) =>
          new CardContentNotFoundError({
            message: `Deck path is outside workspace root: ${invalidDeckPath}`,
          }),
      },
    );

    const deckManager = yield* DeckManager;
    const parsed = yield* deckManager.readDeck(options.deckPath).pipe(
      Effect.catchTags({
        DeckNotFound: (e) => Effect.fail(new CardContentNotFoundError({ message: e.message })),
        DeckReadError: (e) => Effect.fail(new CardContentReadError({ message: e.message })),
        DeckParseError: (e) => Effect.fail(new CardContentParseError({ message: e.message })),
      }),
    );
    const found = findCardLocationById(parsed, options.cardId);

    if (!found) {
      return yield* Effect.fail(
        new CardContentNotFoundError({
          message: `Card not found: ${options.cardId}`,
        }),
      );
    }

    const inferred = yield* inferType(reviewItemTypes, found.item.content).pipe(
      Effect.mapError((error) => new CardContentParseError({ message: error.message })),
    );

    const cards = inferred.type.cards(inferred.content);
    const cardSpec = cards[options.cardIndex];

    if (!cardSpec) {
      return yield* Effect.fail(
        new CardContentIndexOutOfBoundsError({
          cardIndex: options.cardIndex,
          availableCards: cards.length,
        }),
      );
    }

    if (cardSpec.cardType !== "qa" && cardSpec.cardType !== "cloze") {
      return yield* Effect.fail(
        new CardContentParseError({
          message: `Unsupported card type: ${cardSpec.cardType}`,
        }),
      );
    }

    const prompt = yield* rewriteDeckImageUrlsForDesktop({
      rootPath,
      deckPath: options.deckPath,
      markdown: cardSpec.prompt,
    });
    const reveal = yield* rewriteDeckImageUrlsForDesktop({
      rootPath,
      deckPath: options.deckPath,
      markdown: cardSpec.reveal,
    });

    const renderedCardSpec: ReviewRenderedCardSpec = {
      prompt,
      reveal,
      cardType: cardSpec.cardType,
    };

    if (inferred.type === QAType) {
      return {
        rootPath,
        cardType: "qa",
        cardSpec: renderedCardSpec,
        qaContent: inferred.content as QAContent,
      };
    }

    if (inferred.type === ClozeType) {
      return {
        rootPath,
        cardType: "cloze",
        cardSpec: renderedCardSpec,
      };
    }

    return yield* Effect.fail(
      new CardContentParseError({
        message: `Unsupported inferred type: ${inferred.type.name}`,
      }),
    );
  });

const resolveReviewAssistantQaSourceCard = (options: {
  readonly settingsRepository: SettingsRepository;
  readonly deckPath: string;
  readonly cardId: string;
  readonly cardIndex: number;
}): Effect.Effect<
  {
    readonly sourceCard: {
      readonly cardType: "qa";
      readonly content: QAContent;
    };
  },
  | CardContentReadError
  | CardContentNotFoundError
  | CardContentParseError
  | CardContentIndexOutOfBoundsError
  | ReviewAssistantUnsupportedCardTypeError,
  DeckManager | Path.Path
> =>
  Effect.gen(function* () {
    const resolved = yield* loadResolvedReviewCard(options);
    if (resolved.cardType !== "qa") {
      return yield* Effect.fail(
        new ReviewAssistantUnsupportedCardTypeError({
          cardType: resolved.cardType,
          message: `Permutations are not supported for ${resolved.cardType} review cards.`,
        }),
      );
    }

    const question = yield* rewriteDeckImageUrlsForDesktop({
      rootPath: resolved.rootPath,
      deckPath: options.deckPath,
      markdown: resolved.qaContent.question,
    });
    const answer = yield* rewriteDeckImageUrlsForDesktop({
      rootPath: resolved.rootPath,
      deckPath: options.deckPath,
      markdown: resolved.qaContent.answer,
    });

    return {
      sourceCard: {
        cardType: "qa" as const,
        content: {
          question,
          answer,
        },
      },
    };
  });

const normalizeGeneratedPermutations = (
  permutations: ReadonlyArray<{ readonly question: string; readonly answer: string }>,
  source: QAContent,
): ReadonlyArray<{ readonly id: string; readonly question: string; readonly answer: string }> => {
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const sourceQuestion = normalize(source.question);
  const sourceAnswer = normalize(source.answer);
  const seen = new Set<string>();

  return permutations
    .map((permutation) => ({
      question: normalize(permutation.question),
      answer: normalize(permutation.answer),
    }))
    .filter(
      (permutation) =>
        permutation.question.length > 0 &&
        permutation.answer.length > 0 &&
        !(permutation.question === sourceQuestion && permutation.answer === sourceAnswer),
    )
    .filter((permutation) => {
      const key = `${permutation.question}\u0000${permutation.answer}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .map((permutation) => ({
      id: randomUUID(),
      question: permutation.question,
      answer: permutation.answer,
    }));
};

export const createReviewHandlers = () =>
  Effect.gen(function* () {
    const settingsRepository = yield* SettingsRepositoryService;
    const analyticsRepository = yield* AnalyticsRepositoryService;
    const deckWriteCoordinator = yield* DeckWriteCoordinatorService;
    const forgePromptRuntime = yield* ForgePromptRuntimeService;

    return provideHandlerServices({
      BuildReviewQueue: ({ deckPaths, rootPath }) =>
        Effect.gen(function* () {
          const configuredRootPath = yield* validateRequestedRootPathAs(
            settingsRepository,
            rootPath,
            (m) => new ReviewOperationError({ message: m }),
          );

          for (const deckPath of deckPaths) {
            if (!assertWithinRoot(deckPath, configuredRootPath)) {
              return yield* Effect.fail(
                new ReviewOperationError({
                  message: `Deck path is outside workspace root: ${deckPath}`,
                }),
              );
            }
          }

          const queueBuilder = yield* ReviewQueueBuilder;
          const queue = yield* queueBuilder.buildQueue({
            deckPaths,
            rootPath: configuredRootPath,
            now: new Date(),
          });

          return {
            items: queue.items.map((queueItem) => ({
              deckPath: queueItem.deckPath,
              cardId: queueItem.card.id,
              cardIndex: queueItem.cardIndex,
              deckName: queueItem.deckName,
            })),
            totalNew: queue.totalNew,
            totalDue: queue.totalDue,
          };
        }).pipe(Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) }))),
      GetCardContent: ({ deckPath, cardId, cardIndex }) =>
        loadResolvedReviewCard({
          settingsRepository,
          deckPath,
          cardId,
          cardIndex,
        }).pipe(
          Effect.map(({ cardSpec }) => ({
            prompt: cardSpec.prompt,
            reveal: cardSpec.reveal,
            cardType: cardSpec.cardType,
          })),
        ),
      GetReviewAssistantSourceCard: ({ deckPath, cardId, cardIndex }) =>
        resolveReviewAssistantQaSourceCard({
          settingsRepository,
          deckPath,
          cardId,
          cardIndex,
        }),
      ReviewGeneratePermutations: ({ deckPath, cardId, cardIndex, instruction, model }) =>
        Effect.gen(function* () {
          const { sourceCard } = yield* resolveReviewAssistantQaSourceCard({
            settingsRepository,
            deckPath,
            cardId,
            cardIndex,
          });

          const promptResult = yield* forgePromptRuntime
            .run(
              GenerateReviewPermutationsPromptSpec,
              {
                sourceCard,
                ...(instruction ? { instruction } : {}),
              },
              model ? { model } : undefined,
            )
            .pipe(
              Effect.mapError(
                (error) =>
                  new ReviewPermutationGenerationError({
                    message: toErrorMessage(error),
                  }),
              ),
            );

          return {
            permutations: normalizeGeneratedPermutations(
              promptResult.output.permutations,
              sourceCard.content,
            ),
          };
        }),
      ScheduleReview: ({ deckPath, cardId, grade }) =>
        Effect.gen(function* () {
          const configuredRootPath = yield* validateDeckAccessAs(
            settingsRepository,
            deckPath,
            (m) => new ReviewOperationError({ message: m }),
          );

          const deckManager = yield* DeckManager;
          const scheduler = yield* Scheduler;

          const reviewedAt = new Date();

          const scheduleResult = yield* deckWriteCoordinator.withDeckLock(
            deckPath,
            Effect.gen(function* () {
              const parsed = yield* deckManager.readDeck(deckPath).pipe(
                Effect.catchTags({
                  DeckNotFound: failWithReviewOperationError,
                  DeckReadError: failWithReviewOperationError,
                  DeckParseError: failWithReviewOperationError,
                }),
              );
              const cardLocation = findCardLocationById(parsed, cardId);

              if (!cardLocation) {
                return yield* Effect.fail(
                  new ReviewOperationError({
                    message: `Card not found: ${cardId}`,
                  }),
                );
              }

              const scheduled = yield* scheduler
                .scheduleReview(cardLocation.card, grade, reviewedAt)
                .pipe(
                  Effect.mapError((error) => new ReviewOperationError({ message: error.message })),
                );

              yield* deckManager.updateCardMetadata(deckPath, cardId, scheduled.updatedCard).pipe(
                Effect.catchTags({
                  DeckNotFound: failWithReviewOperationError,
                  DeckReadError: failWithReviewOperationError,
                  DeckParseError: failWithReviewOperationError,
                  DeckWriteError: failWithReviewOperationError,
                  CardNotFound: failWithReviewOperationError,
                }),
              );

              return {
                previousCard: cardLocation.card,
                previousDue: cardLocation.card.due ?? computeDueDate(cardLocation.card),
                nextCard: scheduled.updatedCard,
                expectedCurrentCardFingerprint: toMetadataFingerprint(scheduled.updatedCard),
                previousCardFingerprint: toMetadataFingerprint(cardLocation.card),
                grade,
                previousState: scheduled.schedulerLog.previousState,
                nextState: scheduled.updatedCard.state,
                previousStability: cardLocation.card.stability.value,
                nextStability: scheduled.updatedCard.stability.value,
                previousDifficulty: cardLocation.card.difficulty.value,
                nextDifficulty: scheduled.updatedCard.difficulty.value,
                previousLearningSteps: cardLocation.card.learningSteps,
                nextLearningSteps: scheduled.updatedCard.learningSteps,
              };
            }),
          );

          const canonicalWorkspacePath = yield* canonicalizeWorkspacePath(configuredRootPath).pipe(
            Effect.catchAll(() => Effect.succeed(configuredRootPath)),
          );
          const deckRelativePath = path.relative(configuredRootPath, deckPath);
          const reviewEntryId = yield* analyticsRepository.recordSchedule({
            workspaceCanonicalPath: canonicalWorkspacePath,
            deckPath,
            deckRelativePath,
            cardId,
            grade: scheduleResult.grade,
            previousState: scheduleResult.previousState,
            nextState: scheduleResult.nextState,
            previousDue: scheduleResult.previousDue,
            nextDue: scheduleResult.nextCard.due,
            previousStability: scheduleResult.previousStability,
            nextStability: scheduleResult.nextStability,
            previousDifficulty: scheduleResult.previousDifficulty,
            nextDifficulty: scheduleResult.nextDifficulty,
            previousLearningSteps: scheduleResult.previousLearningSteps,
            nextLearningSteps: scheduleResult.nextLearningSteps,
            reviewedAt,
          });

          return {
            reviewEntryId,
            expectedCurrentCardFingerprint: scheduleResult.expectedCurrentCardFingerprint,
            previousCardFingerprint: scheduleResult.previousCardFingerprint,
            previousCard: scheduleResult.previousCard,
          };
        }).pipe(Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) }))),
      UndoReview: ({
        deckPath,
        cardId,
        previousCard,
        reviewEntryId,
        expectedCurrentCardFingerprint,
        previousCardFingerprint,
      }) =>
        Effect.gen(function* () {
          yield* validateDeckAccessAs(
            settingsRepository,
            deckPath,
            (m) => new ReviewOperationError({ message: m }),
          );

          const intent =
            reviewEntryId === null
              ? null
              : ({
                  intentId: randomUUID(),
                  reviewEntryId,
                  deckPath,
                  cardId,
                  expectedCurrentCardFingerprint,
                  previousCardFingerprint,
                  createdAt: new Date().toISOString(),
                  attemptCount: 0,
                  status: "pending" as const,
                  lastError: null,
                } as const);

          if (intent !== null) {
            yield* analyticsRepository.persistIntent(intent).pipe(
              Effect.mapError(
                (error) =>
                  new UndoSafetyUnavailableError({
                    message: `Failed to persist undo safety intent: ${toErrorMessage(error)}`,
                  }),
              ),
            );
          }

          const deckManager = yield* DeckManager;

          yield* deckWriteCoordinator
            .withDeckLock(
              deckPath,
              Effect.gen(function* () {
                const parsed = yield* deckManager.readDeck(deckPath).pipe(
                  Effect.catchTags({
                    DeckNotFound: failWithReviewOperationError,
                    DeckReadError: failWithReviewOperationError,
                    DeckParseError: failWithReviewOperationError,
                  }),
                );
                const cardLocation = findCardLocationById(parsed, cardId);

                if (!cardLocation) {
                  return yield* Effect.fail(
                    new ReviewOperationError({
                      message: `Card not found: ${cardId}`,
                    }),
                  );
                }

                const actualCurrentCardFingerprint = toMetadataFingerprint(cardLocation.card);
                if (actualCurrentCardFingerprint !== expectedCurrentCardFingerprint) {
                  return yield* Effect.fail(
                    new UndoConflictError({
                      deckPath,
                      cardId,
                      message:
                        "Undo conflict detected. Card metadata changed outside this review session.",
                      expectedCurrentCardFingerprint,
                      actualCurrentCardFingerprint,
                    }),
                  );
                }

                yield* deckManager.updateCardMetadata(deckPath, cardId, previousCard).pipe(
                  Effect.catchTags({
                    DeckNotFound: failWithReviewOperationError,
                    DeckReadError: failWithReviewOperationError,
                    DeckParseError: failWithReviewOperationError,
                    DeckWriteError: failWithReviewOperationError,
                    CardNotFound: failWithReviewOperationError,
                  }),
                );
              }),
            )
            .pipe(
              Effect.catchTag("undo_conflict", (error) =>
                intent === null
                  ? Effect.fail(error)
                  : analyticsRepository
                      .markIntentConflict(intent.intentId, error.message)
                      .pipe(Effect.zipRight(Effect.fail(error))),
              ),
            );

          if (intent !== null) {
            const compensationExit = yield* Effect.exit(
              analyticsRepository.compensateUndo({
                reviewEntryId: intent.reviewEntryId,
                undoneAt: new Date(),
              }),
            );

            if (Exit.isSuccess(compensationExit)) {
              yield* analyticsRepository.markIntentCompleted(intent.intentId);
            } else {
              yield* analyticsRepository.markIntentPendingFailure(
                intent.intentId,
                toErrorMessage(compensationExit.cause),
              );
            }
          }

          return {};
        }),
      GetReviewStats: ({ rootPath, includeUndone }) =>
        Effect.gen(function* () {
          const configuredRootPath = yield* validateRequestedRootPathAs(
            settingsRepository,
            rootPath,
            (m) => new ReviewOperationError({ message: m }),
          );

          const workspaceCanonicalPath = yield* canonicalizeWorkspacePath(configuredRootPath).pipe(
            Effect.mapError(
              (error) =>
                new ReviewOperationError({
                  message: `Unable to canonicalize workspace path: ${toErrorMessage(error)}`,
                }),
            ),
          );

          return yield* analyticsRepository.getReviewStats({
            workspaceCanonicalPath,
            includeUndone: includeUndone ?? false,
          });
        }).pipe(Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) }))),
      ListReviewHistory: ({ rootPath, includeUndone, limit, offset }) =>
        Effect.gen(function* () {
          const configuredRootPath = yield* validateRequestedRootPathAs(
            settingsRepository,
            rootPath,
            (m) => new ReviewOperationError({ message: m }),
          );

          const workspaceCanonicalPath = yield* canonicalizeWorkspacePath(configuredRootPath).pipe(
            Effect.mapError(
              (error) =>
                new ReviewOperationError({
                  message: `Unable to canonicalize workspace path: ${toErrorMessage(error)}`,
                }),
            ),
          );

          const normalizedLimit = Math.max(1, Math.min(500, limit ?? 100));
          const normalizedOffset = Math.max(0, offset ?? 0);

          const entries = yield* analyticsRepository.listReviewHistory({
            workspaceCanonicalPath,
            includeUndone: includeUndone ?? false,
            limit: normalizedLimit,
            offset: normalizedOffset,
          });

          return { entries };
        }).pipe(Effect.mapError((e) => new ReviewOperationError({ message: toErrorMessage(e) }))),
    } satisfies Pick<Implementations<AppContract, ReviewHandlerRuntime>, ReviewHandlerKeys>);
  });
