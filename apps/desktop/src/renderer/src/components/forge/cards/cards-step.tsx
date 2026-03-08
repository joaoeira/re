import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

import {
  useForgeActiveTopicKey,
  useForgeCardsCurationActions,
  useForgeDeckTargetActions,
  useForgeDeletedCardIdsByTopicKey,
  useForgeExpandedCardPanelsByTopicKey,
  useForgeSessionId,
  useForgeSelectedTopics,
  useForgeTargetDeckPath,
} from "../forge-page-context";
import { topicKey } from "../forge-page-store";
import {
  formatQAContent,
  useForgeAddCardToDeckMutation,
  useForgeUpdateCardMutation,
} from "@/hooks/mutations/use-forge-cards-mutations";
import { useForgeCardsSnapshotQuery } from "@/hooks/queries/use-forge-cards-snapshot-query";
import { useScanDecksQuery } from "@/hooks/queries/use-scan-decks-query";
import { useSettingsQuery } from "@/hooks/queries/use-settings-query";
import { useForgeTopicCardsQuery } from "@/hooks/queries/use-forge-topic-cards-query";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import type { ScanDecksResult } from "@re/workspace";
import type {
  ForgeGetTopicCardsResult,
  ForgeTopicCardsStatus,
  ForgeTopicCardsSummary,
} from "@shared/rpc/schemas/forge";
import { mapCreateDeckErrorToError } from "@shared/rpc/schemas/workspace";
import { CardsCanvas } from "./cards-canvas";
import { CardsFooter } from "./cards-footer";
import { CardsSidebar } from "./cards-sidebar";

type CardsTopic = {
  readonly topicKey: string;
  readonly topicId: number;
  readonly family: "detail" | "synthesis";
  readonly text: string;
};

type PersistSessionDeckPathVariables = {
  readonly sessionId: number;
  readonly deckPath: string | null;
};

type ActiveStatusInput = {
  readonly hasTopicQueryError: boolean;
  readonly inFlight: boolean;
  readonly summaryStatus: ForgeTopicCardsStatus | null;
  readonly topicQueryStatus: ForgeTopicCardsStatus | null;
  readonly topicQueryCardCount: number;
  readonly hasTopicQueryResult: boolean;
  readonly hasActiveTopic: boolean;
};

const deriveActiveStatus = ({
  hasTopicQueryError,
  inFlight,
  summaryStatus,
  topicQueryStatus,
  topicQueryCardCount,
  hasTopicQueryResult,
  hasActiveTopic,
}: ActiveStatusInput): ForgeTopicCardsStatus | null => {
  if (hasTopicQueryError && !hasTopicQueryResult) {
    return "error";
  }

  if (inFlight) {
    return "generating";
  }

  if (summaryStatus === "generating") {
    const topicQueryReady =
      topicQueryCardCount > 0 || topicQueryStatus === "generated" || topicQueryStatus === "error";
    if (!topicQueryReady) {
      return "generating";
    }
  }

  if (hasTopicQueryResult && topicQueryStatus) {
    return topicQueryStatus;
  }

  if (summaryStatus) {
    return summaryStatus;
  }

  return hasActiveTopic ? "idle" : null;
};

const inFlightTopicKey = (sessionId: number, topicKeyValue: string): string =>
  `${sessionId}:${topicKeyValue}`;
const TOPIC_BATCH_GENERATION_CONCURRENCY = 3;
const SESSION_DECK_PATH_PERSIST_RETRY_COUNT = 2;
const SESSION_DECK_PATH_PERSIST_RETRY_DELAY_MS = 300;
const EMPTY_DECK_OPTIONS: ReadonlyArray<ScanDecksResult["decks"][number]> = [];

const normalizeDeckRelativePath = (relativePath: string): string =>
  relativePath.endsWith(".md") ? relativePath : `${relativePath}.md`;

const toDeckName = (relativePath: string): string => {
  const fileName = relativePath.split("/").pop() ?? relativePath;
  return fileName.replace(/\.md$/, "");
};

export function CardsStep() {
  const queryClient = useQueryClient();
  const ipc = useIpc();
  const sessionId = useForgeSessionId();

  const curationActions = useForgeCardsCurationActions();
  const activeTopicKey = useForgeActiveTopicKey();
  const deletedByTopicKey = useForgeDeletedCardIdsByTopicKey();
  const expandedPanelsByTopicKey = useForgeExpandedCardPanelsByTopicKey();
  const selectedTopics = useForgeSelectedTopics();
  const targetDeckPath = useForgeTargetDeckPath();
  const deckTargetActions = useForgeDeckTargetActions();

  const settingsQuery = useSettingsQuery();
  const rootPath = settingsQuery.data?.workspace.rootPath ?? null;
  const scanDecksQuery = useScanDecksQuery(rootPath);
  const deckOptions = scanDecksQuery.data?.decks ?? EMPTY_DECK_OPTIONS;
  const [createDeckErrorMessage, setCreateDeckErrorMessage] = useState<string | null>(null);
  const deckOptionPaths = useMemo(
    () => deckOptions.map((deck) => deck.absolutePath),
    [deckOptions],
  );
  const autoSelectScopeKey = `${sessionId ?? "none"}:${rootPath ?? "none"}`;
  const pendingCreatedDeckPathRef = useRef<string | null>(null);
  const persistedDeckPathBySessionIdRef = useRef(new Map<number, string | null>());
  const inFlightDeckPersistKeysRef = useRef(new Set<string>());
  const autoResolvedScopeKeysRef = useRef(new Set<string>());
  const targetDeckPathRef = useRef<string | null>(targetDeckPath);

  useEffect(() => {
    targetDeckPathRef.current = targetDeckPath;
  }, [targetDeckPath]);

  const { mutate: persistSessionDeckPath } = useMutation({
    mutationFn: ({ sessionId, deckPath }: PersistSessionDeckPathVariables) =>
      runIpcEffect(
        ipc.client
          .ForgeSetSessionDeckPath({ sessionId, deckPath })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
    retry: SESSION_DECK_PATH_PERSIST_RETRY_COUNT,
    retryDelay: SESSION_DECK_PATH_PERSIST_RETRY_DELAY_MS,
    onSuccess: (_result, variables) => {
      inFlightDeckPersistKeysRef.current.delete(
        `${variables.sessionId}:${variables.deckPath ?? "null"}`,
      );
      if (targetDeckPathRef.current === variables.deckPath) {
        persistedDeckPathBySessionIdRef.current.set(variables.sessionId, variables.deckPath);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.forgeSessionList, exact: true });
    },
    onError: (error, variables) => {
      inFlightDeckPersistKeysRef.current.delete(
        `${variables.sessionId}:${variables.deckPath ?? "null"}`,
      );

      console.warn("[forge/cards] failed to persist session deck path", {
        sessionId: variables.sessionId,
        deckPath: variables.deckPath,
        error: error.message,
      });
    },
  });

  const { mutate: createDeck, isPending: creatingDeck } = useMutation({
    mutationFn: ({ relativePath }: { relativePath: string; rootPath: string }) =>
      runIpcEffect(
        ipc.client
          .CreateDeck({
            relativePath,
            createParents: true,
          })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
            Effect.mapError(mapCreateDeckErrorToError),
          ),
      ),
    onMutate: () => {
      setCreateDeckErrorMessage(null);
    },
    onSuccess: (result, variables) => {
      const normalizedRelativePath = normalizeDeckRelativePath(variables.relativePath);
      const createdDeck = {
        absolutePath: result.absolutePath,
        relativePath: normalizedRelativePath,
        name: toDeckName(normalizedRelativePath),
      };

      queryClient.setQueryData<ScanDecksResult>(
        queryKeys.scanDecks(variables.rootPath),
        (previous) => {
          if (!previous) {
            return {
              rootPath: variables.rootPath,
              decks: [createdDeck],
            };
          }
          if (previous.decks.some((deck) => deck.absolutePath === createdDeck.absolutePath)) {
            return previous;
          }
          return {
            ...previous,
            decks: [...previous.decks, createdDeck].sort((left, right) =>
              left.relativePath.localeCompare(right.relativePath),
            ),
          };
        },
      );
      pendingCreatedDeckPathRef.current = result.absolutePath;
      deckTargetActions.setTargetDeckPath(result.absolutePath);
    },
    onError: (error) => {
      setCreateDeckErrorMessage(error.message);
    },
    onSettled: (_result, _error, variables) => {
      if (!variables) return;

      void queryClient.invalidateQueries({
        queryKey: queryKeys.scanDecks(variables.rootPath),
        exact: true,
      });
    },
  });

  useEffect(() => {
    if (sessionId === null) return;
    if (!persistedDeckPathBySessionIdRef.current.has(sessionId)) {
      persistedDeckPathBySessionIdRef.current.set(sessionId, targetDeckPath);
    }
  }, [sessionId, targetDeckPath]);

  useEffect(() => {
    if (scanDecksQuery.isFetching || !scanDecksQuery.isSuccess) return;
    if (targetDeckPath === null) {
      if (deckOptionPaths.length > 0 && !autoResolvedScopeKeysRef.current.has(autoSelectScopeKey)) {
        autoResolvedScopeKeysRef.current.add(autoSelectScopeKey);
        deckTargetActions.setTargetDeckPath(deckOptionPaths[0]!);
      }
      return;
    }

    if (deckOptionPaths.includes(targetDeckPath)) {
      autoResolvedScopeKeysRef.current.add(autoSelectScopeKey);
      if (pendingCreatedDeckPathRef.current === targetDeckPath) {
        pendingCreatedDeckPathRef.current = null;
      }
      return;
    }

    if (pendingCreatedDeckPathRef.current === targetDeckPath) return;
    autoResolvedScopeKeysRef.current.add(autoSelectScopeKey);
    deckTargetActions.setTargetDeckPath(null);
  }, [
    autoSelectScopeKey,
    deckOptionPaths,
    deckTargetActions,
    scanDecksQuery.isFetching,
    scanDecksQuery.isSuccess,
    targetDeckPath,
  ]);

  useEffect(() => {
    if (sessionId === null) return;

    const persistedDeckPath = persistedDeckPathBySessionIdRef.current.get(sessionId);
    if (persistedDeckPath === undefined || persistedDeckPath === targetDeckPath) return;

    const persistKey = `${sessionId}:${targetDeckPath ?? "null"}`;
    if (inFlightDeckPersistKeysRef.current.has(persistKey)) return;

    inFlightDeckPersistKeysRef.current.add(persistKey);
    persistSessionDeckPath({
      sessionId,
      deckPath: targetDeckPath,
    });
  }, [persistSessionDeckPath, sessionId, targetDeckPath]);

  const topics = useMemo<ReadonlyArray<CardsTopic>>(
    () =>
      selectedTopics.map((topic) => ({
        topicKey: topicKey(topic.topicId),
        topicId: topic.topicId,
        family: topic.family,
        text: topic.text,
      })),
    [selectedTopics],
  );

  useEffect(() => {
    if (topics.length === 0) {
      if (activeTopicKey !== null) {
        curationActions.setActiveTopic(null);
      }
      return;
    }

    if (!activeTopicKey || !topics.some((topic) => topic.topicKey === activeTopicKey)) {
      curationActions.setActiveTopic(topics[0]!.topicKey);
    }
  }, [activeTopicKey, curationActions, topics]);

  const cardsSnapshotQuery = useForgeCardsSnapshotQuery(sessionId);
  const summaryByTopicKey = useMemo(() => {
    const next = new Map<string, ForgeTopicCardsSummary>();
    const rows = cardsSnapshotQuery.data?.topics ?? [];
    rows.forEach((row) => {
      next.set(topicKey(row.topicId), row);
    });
    return next;
  }, [cardsSnapshotQuery.data]);
  const hasGeneratingTopicsInSnapshot = useMemo(
    () => topics.some((topic) => summaryByTopicKey.get(topic.topicKey)?.status === "generating"),
    [summaryByTopicKey, topics],
  );

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.topicKey === activeTopicKey) ?? null,
    [activeTopicKey, topics],
  );
  const activeTopicRef = useRef<CardsTopic | null>(null);
  useEffect(() => {
    activeTopicRef.current = activeTopic;
  }, [activeTopic]);

  const activeTopicCardsQuery = useForgeTopicCardsQuery(sessionId, activeTopic?.topicId ?? null);
  const [checkedTopicKeys, setCheckedTopicKeys] = useState<ReadonlySet<string>>(new Set());
  const [checkedTopicBatchInFlight, setCheckedTopicBatchInFlight] = useState(false);

  const handleCheckTopic = useCallback((topicKeyValue: string) => {
    setCheckedTopicKeys((prev) => {
      const next = new Set(prev);
      if (next.has(topicKeyValue)) {
        next.delete(topicKeyValue);
      } else {
        next.add(topicKeyValue);
      }
      return next;
    });
  }, []);

  const handleClearChecked = useCallback(() => {
    setCheckedTopicKeys(new Set());
  }, []);

  const handleGenerateChecked = useCallback(() => {
    const checkedTopics = topics.filter((topic) => checkedTopicKeys.has(topic.topicKey));

    if (sessionId === null || checkedTopics.length === 0 || checkedTopicBatchInFlight) {
      return;
    }

    setCheckedTopicKeys(new Set());
    setCheckedTopicBatchInFlight(true);

    const checkedTopicKeySet = new Set(checkedTopics.map((topic) => topic.topicKey));
    queryClient.setQueryData<{ topics: ReadonlyArray<ForgeTopicCardsSummary> }>(
      queryKeys.forgeCardsSnapshot(sessionId),
      (previous) => {
        if (!previous) return previous;
        return {
          topics: previous.topics.map((topic) => {
            const key = topicKey(topic.topicId);
            if (!checkedTopicKeySet.has(key)) return topic;
            return {
              ...topic,
              status: "generating" as const,
              errorMessage: null,
            };
          }),
        };
      },
    );

    const currentActiveTopic = activeTopicRef.current;
    if (currentActiveTopic && checkedTopicKeySet.has(currentActiveTopic.topicKey)) {
      const activeTopicQueryKey = queryKeys.forgeTopicCards(sessionId, currentActiveTopic.topicId);
      queryClient.setQueryData<ForgeGetTopicCardsResult>(activeTopicQueryKey, (previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          topic: {
            ...previous.topic,
            status: "generating",
            errorMessage: null,
          },
        };
      });
    }

    void runIpcEffect(
      ipc.client
        .ForgeGenerateSelectedTopicCards({
          sessionId,
          topicIds: checkedTopics.map((topic) => topic.topicId),
          concurrencyLimit: TOPIC_BATCH_GENERATION_CONCURRENCY,
        })
        .pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
        ),
    )
      .catch(() => undefined)
      .finally(() => {
        setCheckedTopicBatchInFlight(false);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.forgeCardsSnapshot(sessionId),
          exact: true,
        });
        const latestActiveTopic = activeTopicRef.current;
        if (latestActiveTopic) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.forgeTopicCards(sessionId, latestActiveTopic.topicId),
            exact: true,
          });
        }
      });
  }, [checkedTopicBatchInFlight, checkedTopicKeys, ipc.client, queryClient, sessionId, topics]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && checkedTopicKeys.size > 0) {
        setCheckedTopicKeys(new Set());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [checkedTopicKeys.size]);

  const [inFlightTopicKeys, setInFlightTopicKeys] = useState<ReadonlySet<string>>(new Set());
  const inFlightTopicKeysRef = useRef<Set<string>>(new Set());
  const activeTopicGenerationInFlight =
    activeTopicKey !== null && sessionId !== null
      ? inFlightTopicKeys.has(inFlightTopicKey(sessionId, activeTopicKey))
      : false;

  const setTopicInFlight = useCallback(
    (nextSessionId: number, nextTopicKey: string, inFlight: boolean) => {
      const scopedTopicKey = inFlightTopicKey(nextSessionId, nextTopicKey);
      if (inFlight) {
        inFlightTopicKeysRef.current.add(scopedTopicKey);
      } else {
        inFlightTopicKeysRef.current.delete(scopedTopicKey);
      }
      setInFlightTopicKeys(new Set(inFlightTopicKeysRef.current));
    },
    [],
  );

  useEffect(() => {
    inFlightTopicKeysRef.current = new Set();
    setInFlightTopicKeys(new Set());
  }, [sessionId]);

  useEffect(() => {
    if (sessionId === null) return;

    const shouldPollGeneration =
      checkedTopicBatchInFlight || inFlightTopicKeys.size > 0 || hasGeneratingTopicsInSnapshot;
    if (!shouldPollGeneration) return;

    const intervalId = window.setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.forgeCardsSnapshot(sessionId),
        exact: true,
      });

      if (activeTopic) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.forgeTopicCards(sessionId, activeTopic.topicId),
          exact: true,
        });
      }
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    activeTopic,
    checkedTopicBatchInFlight,
    hasGeneratingTopicsInSnapshot,
    inFlightTopicKeys.size,
    queryClient,
    sessionId,
  ]);

  const { mutate: updateCard } = useForgeUpdateCardMutation();
  const { mutate: addCardToDeck } = useForgeAddCardToDeckMutation();
  const [addingCardIds, setAddingCardIds] = useState<ReadonlySet<number>>(new Set());
  const [addCardError, setAddCardError] = useState<string | null>(null);

  const generationRevisionByTopicKeyRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const previousRevisionsByTopicKey = generationRevisionByTopicKeyRef.current;
    const nextRevisionsByTopicKey = new Map<string, number>();

    topics.forEach((topic) => {
      const summary = summaryByTopicKey.get(topic.topicKey);
      if (!summary) return;

      const previousRevision = previousRevisionsByTopicKey.get(topic.topicKey);
      if (typeof previousRevision === "number" && previousRevision !== summary.generationRevision) {
        curationActions.clearTopicCuration(topic.topicKey);
      }

      nextRevisionsByTopicKey.set(topic.topicKey, summary.generationRevision);
    });

    generationRevisionByTopicKeyRef.current = nextRevisionsByTopicKey;
  }, [curationActions, summaryByTopicKey, topics]);

  const patchSnapshotTopicSummary = useCallback(
    (nextSummary: ForgeTopicCardsSummary, fallbackInvalidate = true) => {
      if (sessionId === null) return;

      let patched = false;
      queryClient.setQueryData<{ topics: ReadonlyArray<ForgeTopicCardsSummary> }>(
        queryKeys.forgeCardsSnapshot(sessionId),
        (previous) => {
          if (!previous) return previous;
          patched = true;

          const nextTopics = previous.topics.map((topic) =>
            topic.topicId === nextSummary.topicId ? nextSummary : topic,
          );

          const exists = nextTopics.some((topic) => topic.topicId === nextSummary.topicId);
          return {
            topics: exists ? nextTopics : [...nextTopics, nextSummary],
          };
        },
      );

      if (!patched && fallbackInvalidate) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.forgeCardsSnapshot(sessionId),
          exact: true,
        });
      }
    },
    [queryClient, sessionId],
  );

  const requestTopicGeneration = useCallback(
    (topic: CardsTopic) => {
      if (sessionId === null) return;
      const scopedTopicKey = inFlightTopicKey(sessionId, topic.topicKey);
      if (inFlightTopicKeysRef.current.has(scopedTopicKey)) {
        return;
      }

      const existing = summaryByTopicKey.get(topic.topicKey);
      const topicQueryKey = queryKeys.forgeTopicCards(sessionId, topic.topicId);
      setTopicInFlight(sessionId, topic.topicKey, true);
      queryClient.setQueryData<ForgeGetTopicCardsResult>(topicQueryKey, (previous) => {
        if (previous) {
          return {
            ...previous,
            topic: {
              ...previous.topic,
              status: "generating",
              errorMessage: null,
            },
          };
        }
        if (!existing) return previous;
        return {
          topic: {
            ...existing,
            status: "generating",
            errorMessage: null,
          },
          cards: [],
        };
      });
      if (existing) {
        patchSnapshotTopicSummary(
          {
            ...existing,
            status: "generating",
            errorMessage: null,
          },
          false,
        );
      }

      void runIpcEffect(
        ipc.client
          .ForgeGenerateTopicCards({
            sessionId,
            topicId: topic.topicId,
          })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      )
        .then((result) => {
          queryClient.setQueryData<ForgeGetTopicCardsResult>(topicQueryKey, () => result);
          patchSnapshotTopicSummary(result.topic, true);
        })
        .catch(() => {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.forgeCardsSnapshot(sessionId),
            exact: true,
          });
          void queryClient.invalidateQueries({
            queryKey: topicQueryKey,
            exact: true,
          });
        })
        .finally(() => {
          setTopicInFlight(sessionId, topic.topicKey, false);
        });
    },
    [
      ipc.client,
      patchSnapshotTopicSummary,
      queryClient,
      sessionId,
      setTopicInFlight,
      summaryByTopicKey,
    ],
  );

  const autoStartedSessionIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (sessionId === null || !cardsSnapshotQuery.data) return;
    if (autoStartedSessionIdRef.current === sessionId) return;
    autoStartedSessionIdRef.current = sessionId;

    const selectedSummaries = topics.map((topic) => summaryByTopicKey.get(topic.topicKey) ?? null);
    const hasExistingCards = selectedSummaries.some((summary) => (summary?.cardCount ?? 0) > 0);
    if (hasExistingCards) return;

    const topicsToGenerate = topics
      .filter((topic) => {
        const summary = summaryByTopicKey.get(topic.topicKey);
        return summary?.status !== "generating";
      })
      .slice(0, 3);

    topicsToGenerate.forEach((topic) => {
      requestTopicGeneration(topic);
    });
  }, [cardsSnapshotQuery.data, requestTopicGeneration, sessionId, summaryByTopicKey, topics]);

  const activeAddedCardIds = useMemo(() => {
    const next = new Set<number>();
    for (const card of activeTopicCardsQuery.data?.cards ?? []) {
      if (card.addedToDeck) {
        next.add(card.id);
      }
    }
    return next;
  }, [activeTopicCardsQuery.data]);
  const activeDeletedCardIds = useMemo(
    () =>
      activeTopicKey
        ? (deletedByTopicKey.get(activeTopicKey) ?? new Set<number>())
        : new Set<number>(),
    [activeTopicKey, deletedByTopicKey],
  );
  const activeExpandedPanels = useMemo(
    () =>
      activeTopicKey
        ? (expandedPanelsByTopicKey.get(activeTopicKey) ??
          new Map<number, "permutations" | "cloze">())
        : new Map<number, "permutations" | "cloze">(),
    [activeTopicKey, expandedPanelsByTopicKey],
  );

  const sidebarTopics = useMemo(() => {
    return topics.map((topic) => {
      const summary = summaryByTopicKey.get(topic.topicKey);
      const deletedCount = deletedByTopicKey.get(topic.topicKey)?.size ?? 0;
      const addedCount = summary?.addedCount ?? 0;
      const cardCount = Math.max(0, (summary?.cardCount ?? 0) - deletedCount);

      return {
        topicKey: topic.topicKey,
        family: topic.family,
        text: summary?.topicText ?? topic.text,
        status: summary?.status ?? "idle",
        cardCount,
        addedCount: Math.min(addedCount, cardCount),
      };
    });
  }, [deletedByTopicKey, summaryByTopicKey, topics]);

  const { totalCards, totalAdded } = useMemo(() => {
    return sidebarTopics.reduce(
      (acc, topic) => ({
        totalCards: acc.totalCards + topic.cardCount,
        totalAdded: acc.totalAdded + topic.addedCount,
      }),
      { totalCards: 0, totalAdded: 0 },
    );
  }, [sidebarTopics]);

  const activeSummary = activeTopic ? (summaryByTopicKey.get(activeTopic.topicKey) ?? null) : null;
  const activeTopicResult = activeTopicCardsQuery.data;

  const activeStatus = deriveActiveStatus({
    hasTopicQueryError: Boolean(activeTopicCardsQuery.error),
    inFlight: activeTopicGenerationInFlight,
    summaryStatus: activeSummary?.status ?? null,
    topicQueryStatus: activeTopicResult?.topic.status ?? null,
    topicQueryCardCount: activeTopicResult?.cards.length ?? 0,
    hasTopicQueryResult: Boolean(activeTopicResult),
    hasActiveTopic: activeTopic !== null,
  });

  const activeErrorMessage =
    activeTopicCardsQuery.error?.message ??
    activeTopicResult?.topic.errorMessage ??
    activeSummary?.errorMessage ??
    null;

  const activeCards = activeTopicResult?.cards ?? [];

  const handleEditCard = useCallback(
    (cardId: number, field: "question" | "answer", value: string) => {
      if (!activeTopic || sessionId === null) return;

      const topicQueryKey = queryKeys.forgeTopicCards(sessionId, activeTopic.topicId);
      const previous = queryClient.getQueryData<ForgeGetTopicCardsResult>(topicQueryKey);

      const previousCard = previous?.cards.find((card) => card.id === cardId);
      if (!previousCard) return;

      const nextQuestion = field === "question" ? value : previousCard.question;
      const nextAnswer = field === "answer" ? value : previousCard.answer;

      queryClient.setQueryData(topicQueryKey, (current: typeof previous) => {
        if (!current) return current;
        return {
          ...current,
          cards: current.cards.map((card) =>
            card.id === cardId ? { ...card, question: nextQuestion, answer: nextAnswer } : card,
          ),
        };
      });

      updateCard(
        {
          cardId,
          question: nextQuestion,
          answer: nextAnswer,
        },
        {
          onError: () => {
            queryClient.setQueryData(topicQueryKey, previous);
          },
          onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: topicQueryKey, exact: true });
          },
        },
      );
    },
    [activeTopic, queryClient, sessionId, updateCard],
  );

  const handleDeckPathChange = useCallback(
    (deckPath: string | null) => {
      if (deckPath === targetDeckPath) return;
      setCreateDeckErrorMessage(null);
      deckTargetActions.setTargetDeckPath(deckPath);
    },
    [deckTargetActions, targetDeckPath],
  );

  const handleCreateDeck = useCallback(
    (relativePath: string) => {
      if (!rootPath || creatingDeck) return;
      createDeck({ relativePath, rootPath });
    },
    [createDeck, creatingDeck, rootPath],
  );

  const deckSelectionDisabled = rootPath === null || settingsQuery.isLoading || creatingDeck;

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <CardsSidebar
          topics={sidebarTopics}
          activeTopicKey={activeTopicKey}
          checkedTopicKeys={checkedTopicKeys}
          generatingChecked={checkedTopicBatchInFlight}
          onSelectTopic={(nextTopicKey) => curationActions.setActiveTopic(nextTopicKey)}
          onCheckTopic={handleCheckTopic}
          onClearChecked={handleClearChecked}
          onGenerateChecked={handleGenerateChecked}
        />
        <CardsCanvas
          topicText={activeTopicResult?.topic.topicText ?? activeTopic?.text ?? null}
          status={activeStatus}
          errorMessage={activeErrorMessage}
          cards={activeCards}
          addedCardIds={activeAddedCardIds}
          deletedCardIds={activeDeletedCardIds}
          expandedPanels={activeExpandedPanels}
          addingCardIds={addingCardIds}
          addDisabled={!targetDeckPath}
          addCardError={addCardError}
          onAddCard={(cardId) => {
            if (!activeTopicKey || !activeTopic || sessionId === null || !targetDeckPath) return;
            if (addingCardIds.has(cardId)) return;
            const card = activeCards.find((c) => c.id === cardId);
            if (!card) return;
            const topicQueryKey = queryKeys.forgeTopicCards(sessionId, activeTopic.topicId);
            setAddingCardIds((prev) => new Set([...prev, cardId]));
            setAddCardError(null);
            addCardToDeck(
              {
                deckPath: targetDeckPath,
                content: formatQAContent(card.question, card.answer),
                cardType: "qa",
                sourceCardId: cardId,
              },
              {
                onSuccess: () => {
                  queryClient.setQueryData<ForgeGetTopicCardsResult>(topicQueryKey, (previous) => {
                    if (!previous) return previous;
                    return {
                      ...previous,
                      cards: previous.cards.map((entry) =>
                        entry.id === cardId ? { ...entry, addedToDeck: true } : entry,
                      ),
                    };
                  });

                  queryClient.setQueryData<{ topics: ReadonlyArray<ForgeTopicCardsSummary> }>(
                    queryKeys.forgeCardsSnapshot(sessionId),
                    (previous) => {
                      if (!previous) return previous;
                      return {
                        topics: previous.topics.map((topic) => {
                          if (topic.topicId !== activeTopic.topicId) {
                            return topic;
                          }
                          return {
                            ...topic,
                            addedCount: Math.min(topic.cardCount, topic.addedCount + 1),
                          };
                        }),
                      };
                    },
                  );
                },
                onError: (error) => setAddCardError(error.message),
                onSettled: () =>
                  setAddingCardIds((prev) => {
                    const next = new Set(prev);
                    next.delete(cardId);
                    return next;
                  }),
              },
            );
          }}
          onDeleteCard={(cardId) => {
            if (!activeTopicKey) return;
            curationActions.markCardDeleted(activeTopicKey, cardId);
          }}
          onTogglePanel={(cardId, panel) => {
            if (!activeTopicKey) return;
            const current = activeExpandedPanels.get(cardId) ?? null;
            const next = current === panel ? null : panel;
            curationActions.setCardExpandedPanel(activeTopicKey, cardId, next);
          }}
          onEditCard={handleEditCard}
          onRegenerate={() => {
            if (!activeTopic) return;
            requestTopicGeneration(activeTopic);
          }}
          onGenerateCards={() => {
            if (!activeTopic) return;
            requestTopicGeneration(activeTopic);
          }}
        />
      </div>
      <CardsFooter
        addedCount={totalAdded}
        totalCount={totalCards}
        deckPath={targetDeckPath}
        decks={deckOptions}
        disabled={deckSelectionDisabled}
        deckErrorMessage={createDeckErrorMessage}
        onDeckPathChange={handleDeckPathChange}
        onCreateDeck={handleCreateDeck}
      />
    </>
  );
}
