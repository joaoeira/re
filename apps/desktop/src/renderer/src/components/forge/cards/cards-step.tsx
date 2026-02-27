import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  useForgeActiveTopicKey,
  useForgeAddedCardIdsByTopicKey,
  useForgeCardsCurationActions,
  useForgeDeletedCardIdsByTopicKey,
  useForgeExpandedCardPanelsByTopicKey,
  useForgeExtractSummary,
  useForgeSelectedTopicKeys,
  useForgeTopicsByChunk,
} from "../forge-page-context";
import { topicKey } from "../forge-page-store";
import {
  useForgeGenerateTopicCardsMutation,
  useForgeUpdateCardMutation,
} from "@/hooks/mutations/use-forge-cards-mutations";
import { useForgeCardsSnapshotQuery } from "@/hooks/queries/use-forge-cards-snapshot-query";
import { useForgeTopicCardsQuery } from "@/hooks/queries/use-forge-topic-cards-query";
import { queryKeys } from "@/lib/query-keys";
import type { ForgeGetTopicCardsResult, ForgeTopicCardsSummary } from "@shared/rpc/schemas/forge";
import { CardsCanvas } from "./cards-canvas";
import { CardsFooter } from "./cards-footer";
import { CardsSidebar } from "./cards-sidebar";

type CardsTopic = {
  readonly topicKey: string;
  readonly chunkId: number;
  readonly topicIndex: number;
  readonly text: string;
};

export function CardsStep() {
  const queryClient = useQueryClient();
  const extractSummary = useForgeExtractSummary();
  const sessionId = extractSummary?.sessionId ?? null;

  const curationActions = useForgeCardsCurationActions();
  const activeTopicKey = useForgeActiveTopicKey();
  const addedByTopicKey = useForgeAddedCardIdsByTopicKey();
  const deletedByTopicKey = useForgeDeletedCardIdsByTopicKey();
  const expandedPanelsByTopicKey = useForgeExpandedCardPanelsByTopicKey();
  const topicsByChunk = useForgeTopicsByChunk();
  const selectedTopicKeys = useForgeSelectedTopicKeys();

  const topics = useMemo<ReadonlyArray<CardsTopic>>(() => {
    const selected: CardsTopic[] = [];
    for (const chunk of topicsByChunk) {
      for (let index = 0; index < chunk.topics.length; index += 1) {
        const key = topicKey(chunk.chunkId, index);
        if (!selectedTopicKeys.has(key)) continue;
        selected.push({
          topicKey: key,
          chunkId: chunk.chunkId,
          topicIndex: index,
          text: chunk.topics[index]!,
        });
      }
    }
    return selected;
  }, [selectedTopicKeys, topicsByChunk]);

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
      next.set(topicKey(row.chunkId, row.topicIndex), row);
    });
    return next;
  }, [cardsSnapshotQuery.data]);

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.topicKey === activeTopicKey) ?? null,
    [activeTopicKey, topics],
  );

  const activeTopicCardsQuery = useForgeTopicCardsQuery(
    sessionId,
    activeTopic?.chunkId ?? null,
    activeTopic?.topicIndex ?? null,
  );

  const { mutate: generateTopicCards } = useForgeGenerateTopicCardsMutation();
  const { mutate: updateCard } = useForgeUpdateCardMutation();

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
    (
      nextSummary: {
        readonly topicId: number;
        readonly chunkId: number;
        readonly sequenceOrder: number;
        readonly topicIndex: number;
        readonly topicText: string;
        readonly status: "idle" | "generating" | "generated" | "error";
        readonly errorMessage: string | null;
        readonly cardCount: number;
        readonly generationRevision: number;
      },
      fallbackInvalidate = true,
    ) => {
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

      const existing = summaryByTopicKey.get(topic.topicKey);
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

      generateTopicCards(
        {
          sessionId,
          chunkId: topic.chunkId,
          topicIndex: topic.topicIndex,
        },
        {
          onSuccess: (result) => {
            queryClient.setQueryData<ForgeGetTopicCardsResult>(
              queryKeys.forgeTopicCards(sessionId, topic.chunkId, topic.topicIndex),
              () => result,
            );
            patchSnapshotTopicSummary(result.topic, true);
          },
          onError: () => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.forgeCardsSnapshot(sessionId),
              exact: true,
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.forgeTopicCards(sessionId, topic.chunkId, topic.topicIndex),
              exact: true,
            });
          },
        },
      );
    },
    [generateTopicCards, patchSnapshotTopicSummary, queryClient, sessionId, summaryByTopicKey],
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

  const activeAddedCardIds = useMemo(
    () =>
      activeTopicKey
        ? (addedByTopicKey.get(activeTopicKey) ?? new Set<number>())
        : new Set<number>(),
    [activeTopicKey, addedByTopicKey],
  );
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
      const addedCount = addedByTopicKey.get(topic.topicKey)?.size ?? 0;
      const cardCount = Math.max(0, (summary?.cardCount ?? 0) - deletedCount);

      return {
        topicKey: topic.topicKey,
        text: summary?.topicText ?? topic.text,
        status: summary?.status ?? "idle",
        cardCount,
        addedCount: Math.min(addedCount, cardCount),
      };
    });
  }, [addedByTopicKey, deletedByTopicKey, summaryByTopicKey, topics]);

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

  const activeStatus = (() => {
    if (activeTopicCardsQuery.error && !activeTopicResult) {
      return "error" as const;
    }

    if (activeSummary?.status === "generating") {
      return "generating" as const;
    }

    return (
      activeTopicResult?.topic.status ?? activeSummary?.status ?? (activeTopic ? "idle" : null)
    );
  })();

  const activeErrorMessage =
    activeTopicCardsQuery.error?.message ??
    activeTopicResult?.topic.errorMessage ??
    activeSummary?.errorMessage ??
    null;

  const activeCards = activeTopicResult?.cards ?? [];

  const handleEditCard = useCallback(
    (cardId: number, field: "question" | "answer", value: string) => {
      if (!activeTopic || sessionId === null) return;

      const topicQueryKey = queryKeys.forgeTopicCards(
        sessionId,
        activeTopic.chunkId,
        activeTopic.topicIndex,
      );
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

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <CardsSidebar
          topics={sidebarTopics}
          activeTopicKey={activeTopicKey}
          totalAdded={totalAdded}
          totalCards={totalCards}
          onSelectTopic={(nextTopicKey) => curationActions.setActiveTopic(nextTopicKey)}
        />
        <CardsCanvas
          topicText={activeTopicResult?.topic.topicText ?? activeTopic?.text ?? null}
          status={activeStatus}
          errorMessage={activeErrorMessage}
          cards={activeCards}
          addedCardIds={activeAddedCardIds}
          deletedCardIds={activeDeletedCardIds}
          expandedPanels={activeExpandedPanels}
          onAddCard={(cardId) => {
            if (!activeTopicKey) return;
            curationActions.markCardAdded(activeTopicKey, cardId);
          }}
          onDeleteCard={(cardId) => {
            if (!activeTopicKey) return;
            curationActions.markCardDeleted(activeTopicKey, cardId);
          }}
          onTogglePanel={(cardId, panel) => {
            if (!activeTopicKey) return;
            const current = activeExpandedPanels.get(cardId) ?? null;
            curationActions.setCardExpandedPanel(
              activeTopicKey,
              cardId,
              current === panel ? null : panel,
            );
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
      <CardsFooter addedCount={totalAdded} totalCount={totalCards} />
    </>
  );
}
