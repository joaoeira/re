import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { Effect } from "effect";

import { useForgePreviewQuery } from "@/hooks/queries/use-forge-preview-query";
import { useForgeSessionListQuery } from "@/hooks/queries/use-forge-session-list-query";
import { useForgeTopicSnapshotQuery } from "@/hooks/queries/use-forge-topic-snapshot-query";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { forgeSourceCacheKey, queryKeys } from "@/lib/query-keys";
import {
  ForgeExtractionSessionCreated,
  ForgeTopicChunkExtracted,
} from "@shared/rpc/contracts";
import type {
  DerivationParentRef,
  ForgeSessionSummary,
  ForgeSourceInput,
  ForgeTopicCardsSummary,
  ForgeTopicExtractionOutcome,
  ForgeTopicGroup,
} from "@shared/rpc/schemas/forge";
import {
  createForgePageStore,
  type ExpansionColumnDescriptor,
  type ForgeCardExpandedPanel,
  topicKey,
  type ExtractState,
  type ExtractSummary,
  type ForgePageStore,
  type ForgeSourceEntryMode,
  type ForgeStep,
  type PreviewState,
  type TopicCardIdMap,
  type TopicExpandedCardPanelMap,
  type TopicExpansionColumnsMap,
} from "./forge-page-store";
import {
  createPdfSelectedSource,
  createTextSelectedSource,
  forgeSelectedSourceCacheKey,
  forgeSelectedSourceFromSession,
  toForgeSourceInput,
  type ForgeSelectedSource,
} from "./forge-source";

type ForgePageActions = {
  readonly handleFileSelected: (file: File | null) => void;
  readonly openTextEditor: () => void;
  readonly closeTextEditor: () => void;
  readonly setTextDraft: (text: string) => void;
  readonly setTextTitleDraft: (title: string) => void;
  readonly submitTextSource: () => void;
  readonly beginExtraction: () => void;
  readonly advanceToCards: () => void;
  readonly resumeSession: (session: ForgeSessionSummary) => void;
};

type ForgePageContextValue = {
  readonly store: ForgePageStore;
  readonly actions: ForgePageActions;
};

const ForgePageContext = createContext<ForgePageContextValue | null>(null);

function useForgePageContextValue(): ForgePageContextValue {
  const context = useContext(ForgePageContext);
  if (!context) throw new Error("ForgePageProvider is missing from the component tree");
  return context;
}

export function useForgePageStore(): ForgePageStore {
  return useForgePageContextValue().store;
}

export function useForgePageActions(): ForgePageActions {
  return useForgePageContextValue().actions;
}

function useForgePageSelector<T>(
  selector: (snapshot: ReturnType<ForgePageStore["getSnapshot"]>) => T,
): T {
  const store = useForgePageStore();
  return useSelector(store, selector);
}

export function useForgeCurrentStep(): ForgeStep {
  return useForgePageSelector((snapshot) => snapshot.context.currentStep);
}

export function useForgeSelectedSource(): ForgeSelectedSource | null {
  return useForgePageSelector((snapshot) => snapshot.context.selectedSource);
}

export function useForgeSourceEntryMode(): ForgeSourceEntryMode {
  return useForgePageSelector((snapshot) => snapshot.context.sourceEntryMode);
}

export function useForgeTextDraft(): string {
  return useForgePageSelector((snapshot) => snapshot.context.textDraft);
}

export function useForgeTextTitleDraft(): string {
  return useForgePageSelector((snapshot) => snapshot.context.textTitleDraft);
}

export function useForgeDuplicateOfSessionId(): number | null {
  return useForgePageSelector((snapshot) => snapshot.context.duplicateOfSessionId);
}

function useForgeSourceSelectionErrorMessage(): string | null {
  return useForgePageSelector((snapshot) => snapshot.context.sourceSelectionErrorMessage);
}

export function useForgePreviewState(): PreviewState {
  const selectedSource = useForgeSelectedSource();
  const sourceEntryMode = useForgeSourceEntryMode();
  const sourceSelectionErrorMessage = useForgeSourceSelectionErrorMessage();

  const previewSource =
    sourceEntryMode === "picker" && selectedSource?.kind === "pdf"
      ? toForgeSourceInput(selectedSource)
      : null;

  const previewQuery = useForgePreviewQuery(previewSource);

  if (sourceSelectionErrorMessage) return { status: "error", message: sourceSelectionErrorMessage };
  if (!previewSource) return { status: "idle" };
  if (previewQuery.data) return { status: "ready", summary: previewQuery.data };
  if (previewQuery.error) return { status: "error", message: previewQuery.error.message };
  if (previewQuery.isLoading) return { status: "loading" };
  return { status: "idle" };
}

export function useForgeExtractState(): ExtractState {
  return useForgePageSelector((snapshot) => snapshot.context.extractState);
}

export function useForgeExtractSummary(): ExtractSummary | null {
  return useForgePageSelector((snapshot) => snapshot.context.extractSummary);
}

export function useForgeSessionId(): number | null {
  return useForgePageSelector((snapshot) => snapshot.context.activeExtractionSessionId);
}

export function useForgeTopicSyncErrorMessage(): string | null {
  return useForgePageSelector((snapshot) => snapshot.context.topicSyncErrorMessage);
}

export function useForgeResumeErrorMessage(): string | null {
  return useForgePageSelector((snapshot) => snapshot.context.resumeErrorMessage);
}

export function useForgeTopicGroups(): ReadonlyArray<ForgeTopicGroup> {
  return useForgePageSelector((snapshot) => snapshot.context.topicGroups);
}

export function useForgeSelectedTopicKeys(): ReadonlySet<string> {
  return useForgePageSelector((snapshot) => snapshot.context.selectedTopicKeys);
}

export function useForgeActiveTopicKey(): string | null {
  return useForgePageSelector((snapshot) => snapshot.context.activeTopicKey);
}

export function useForgeTargetDeckPath(): string | null {
  return useForgePageSelector((snapshot) => snapshot.context.targetDeckPath);
}

export function useForgeDeletedCardIdsByTopicKey(): TopicCardIdMap {
  return useForgePageSelector((snapshot) => snapshot.context.deletedCardIdsByTopicKey);
}

export function useForgeExpandedCardPanelsByTopicKey(): TopicExpandedCardPanelMap {
  return useForgePageSelector((snapshot) => snapshot.context.expandedCardPanelsByTopicKey);
}

export function useForgeExpansionColumnsByTopicKey(): TopicExpansionColumnsMap {
  return useForgePageSelector((snapshot) => snapshot.context.expansionColumnsByTopicKey);
}

export function useForgeExpansionColumns(): ReadonlyArray<ExpansionColumnDescriptor> {
  const activeTopicKey = useForgeActiveTopicKey();
  const columnsByTopicKey = useForgeExpansionColumnsByTopicKey();

  return useMemo(
    () => (activeTopicKey ? (columnsByTopicKey.get(activeTopicKey) ?? []) : []),
    [activeTopicKey, columnsByTopicKey],
  );
}

export function useForgeTopicExtractionOutcomes(): ReadonlyArray<ForgeTopicExtractionOutcome> {
  return useForgePageSelector((snapshot) => snapshot.context.extractionOutcomes);
}

export function useForgeSelectedTopicCount(): number {
  return useForgePageSelector((snapshot) => snapshot.context.selectedTopicKeys.size);
}

export type SelectedTopic = {
  readonly topicId: number;
  readonly family: "detail";
  readonly chunkId: number | null;
  readonly topicIndex: number;
  readonly text: string;
};

const flattenTopicGroups = (groups: ReadonlyArray<ForgeTopicGroup>) =>
  groups.flatMap((group) => group.topics);

export function useForgeSelectedTopics(): ReadonlyArray<SelectedTopic> {
  const topicGroups = useForgeTopicGroups();
  const selectedTopicKeys = useForgeSelectedTopicKeys();

  return useMemo(
    () =>
      flattenTopicGroups(topicGroups)
        .filter((topic) => selectedTopicKeys.has(topicKey(topic.topicId)))
        .map((topic) => ({
          topicId: topic.topicId,
          family: topic.family,
          chunkId: topic.chunkId,
          topicIndex: topic.topicIndex,
          text: topic.topicText,
        })),
    [selectedTopicKeys, topicGroups],
  );
}

export type ForgeTopicActions = {
  readonly toggleTopic: (topicId: number) => void;
  readonly toggleGroup: (groupId: string, select: boolean) => void;
  readonly selectAllTopics: () => void;
  readonly deselectAllTopics: () => void;
};

export function useForgeTopicActions(): ForgeTopicActions {
  const store = useForgePageStore();
  return useMemo(
    () => ({
      toggleTopic: (topicId: number) => store.send({ type: "toggleTopic", topicId }),
      toggleGroup: (groupId: string, select: boolean) =>
        store.send({ type: "toggleGroup", groupId, select }),
      selectAllTopics: () => store.send({ type: "selectAllTopics" }),
      deselectAllTopics: () => store.send({ type: "deselectAllTopics" }),
    }),
    [store],
  );
}

export type ForgeCardsCurationActions = {
  readonly setActiveTopic: (topicKey: string | null) => void;
  readonly markCardDeleted: (topicKey: string, cardId: number) => void;
  readonly setCardExpandedPanel: (
    topicKey: string,
    cardId: number,
    panel: ForgeCardExpandedPanel | null,
  ) => void;
  readonly clearTopicCuration: (topicKey: string) => void;
  readonly openExpansionColumn: (
    topicKey: string,
    descriptor: ExpansionColumnDescriptor,
    sourceColumnParent: DerivationParentRef | null,
  ) => void;
  readonly closeExpansionColumn: (topicKey: string, columnId: string) => void;
  readonly truncateExpansionColumns: (topicKey: string, columnId: string) => void;
  readonly clearExpansionColumns: (topicKey: string) => void;
};

export function useForgeCardsCurationActions(): ForgeCardsCurationActions {
  const store = useForgePageStore();
  return useMemo(
    () => ({
      setActiveTopic: (topicKey: string | null) =>
        store.send({ type: "setActiveCardsTopic", topicKey }),
      markCardDeleted: (topicKey: string, cardId: number) =>
        store.send({ type: "markCardDeletedFromTopic", topicKey, cardId }),
      setCardExpandedPanel: (
        topicKey: string,
        cardId: number,
        panel: ForgeCardExpandedPanel | null,
      ) => store.send({ type: "setCardExpandedPanelForTopic", topicKey, cardId, panel }),
      clearTopicCuration: (topicKey: string) =>
        store.send({ type: "clearTopicCuration", topicKey }),
      openExpansionColumn: (
        topicKey: string,
        descriptor: ExpansionColumnDescriptor,
        sourceColumnParent: DerivationParentRef | null,
      ) =>
        store.send({
          type: "openExpansionColumnForTopic",
          topicKey,
          descriptor,
          sourceColumnParent,
        }),
      closeExpansionColumn: (topicKey: string, columnId: string) =>
        store.send({ type: "closeExpansionColumnForTopic", topicKey, columnId }),
      truncateExpansionColumns: (topicKey: string, columnId: string) =>
        store.send({ type: "truncateExpansionColumnsForTopic", topicKey, columnId }),
      clearExpansionColumns: (topicKey: string) =>
        store.send({ type: "clearExpansionColumnsForTopic", topicKey }),
    }),
    [store],
  );
}

export type ForgeDeckTargetActions = {
  readonly setTargetDeckPath: (deckPath: string | null) => void;
};

export function useForgeDeckTargetActions(): ForgeDeckTargetActions {
  const store = useForgePageStore();
  return useMemo(
    () => ({
      setTargetDeckPath: (deckPath: string | null) =>
        store.send({ type: "setTargetDeckPath", deckPath }),
    }),
    [store],
  );
}

export function topicSummariesToTopicGroups(
  topics: ReadonlyArray<ForgeTopicCardsSummary>,
): ReadonlyArray<ForgeTopicGroup> {
  const detailGroups = new Map<
    number,
    {
      readonly chunkId: number;
      readonly displayOrder: number;
      readonly topics: Array<{
        readonly topicId: number;
        readonly sessionId: number;
        readonly family: "detail";
        readonly chunkId: number | null;
        readonly chunkSequenceOrder: number | null;
        readonly topicIndex: number;
        readonly topicText: string;
        readonly selected: boolean;
      }>;
    }
  >();

  for (const topic of topics) {
    if (topic.chunkId === null || topic.chunkSequenceOrder === null) {
      continue;
    }

    const summary = {
      topicId: topic.topicId,
      sessionId: topic.sessionId,
      family: topic.family,
      chunkId: topic.chunkId,
      chunkSequenceOrder: topic.chunkSequenceOrder,
      topicIndex: topic.topicIndex,
      topicText: topic.topicText,
      selected: topic.selected,
    };

    const existing = detailGroups.get(topic.chunkId);
    if (existing) {
      existing.topics.push(summary);
      continue;
    }

    detailGroups.set(topic.chunkId, {
      chunkId: topic.chunkId,
      displayOrder: topic.chunkSequenceOrder,
      topics: [summary],
    });
  }

  return Array.from(detailGroups.values())
    .sort((left, right) => left.displayOrder - right.displayOrder || left.chunkId - right.chunkId)
    .map((group) => ({
      groupId: `chunk:${group.chunkId}`,
      groupKind: "chunk",
      family: "detail",
      title: `Chunk ${group.displayOrder + 1}`,
      displayOrder: group.displayOrder,
      chunkId: group.chunkId,
      topics: group.topics
        .slice()
        .sort((left, right) => left.topicIndex - right.topicIndex || left.topicId - right.topicId),
    }));
}

type ForgePageProviderProps = {
  readonly children: React.ReactNode;
  readonly initialSessionId: number | null;
  readonly onSessionChange: (session: { id: number; sourceLabel: string } | null) => void;
};

export function ForgePageProvider({
  children,
  initialSessionId,
  onSessionChange,
}: ForgePageProviderProps) {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const store = useMemo(() => createForgePageStore(), []);

  const onSessionChangeRef = useRef(onSessionChange);
  onSessionChangeRef.current = onSessionChange;

  const sessionListQuery = useForgeSessionListQuery();

  const currentStep = useSelector(store, (snapshot) => snapshot.context.currentStep);
  const extractState = useSelector(store, (snapshot) => snapshot.context.extractState);
  const activeExtractionSessionId = useSelector(
    store,
    (snapshot) => snapshot.context.activeExtractionSessionId,
  );

  const topicSnapshotQuery = useForgeTopicSnapshotQuery(
    currentStep === "topics" ? activeExtractionSessionId : null,
    {
      refetchIntervalMs: extractState.status === "extracting" ? 2_000 : false,
    },
  );

  useEffect(() => {
    if (activeExtractionSessionId === null || currentStep !== "topics") return;

    if (topicSnapshotQuery.data) {
      store.send({
        type: "topicSnapshotSynced",
        sessionId: topicSnapshotQuery.data.session.id,
        sessionCreatedAt: topicSnapshotQuery.data.session.createdAt,
        sessionStatus: topicSnapshotQuery.data.session.status,
        sessionErrorMessage: topicSnapshotQuery.data.session.errorMessage,
        groups: topicSnapshotQuery.data.groups,
        outcomes: topicSnapshotQuery.data.outcomes,
      });
    }

    if (topicSnapshotQuery.error) {
      if (store.getSnapshot().context.extractState.status !== "extracting") return;
      store.send({ type: "topicSnapshotError", message: topicSnapshotQuery.error.message });
    }
  }, [
    currentStep,
    activeExtractionSessionId,
    topicSnapshotQuery.data,
    topicSnapshotQuery.dataUpdatedAt,
    topicSnapshotQuery.error,
    topicSnapshotQuery.errorUpdatedAt,
    store,
  ]);

  useEffect(() => {
    const handleTopicEvent = (event: { sessionId: number }) => {
      const context = store.getSnapshot().context;
      if (context.activeExtractionSessionId === null) {
        store.send({ type: "extractionSessionCreated", sessionId: event.sessionId });
      } else if (context.activeExtractionSessionId !== event.sessionId) {
        return;
      }

      void queryClient.invalidateQueries({
        queryKey: queryKeys.forgeTopicSnapshot(event.sessionId),
        exact: true,
      });
    };

    const unsubChunk = ipc.events.subscribe(ForgeTopicChunkExtracted, handleTopicEvent);
    const unsubSession = ipc.events.subscribe(ForgeExtractionSessionCreated, (event) => {
      store.send({ type: "extractionSessionCreated", sessionId: event.sessionId });
      void queryClient.invalidateQueries({ queryKey: queryKeys.forgeSessionList, exact: true });
    });

    return () => {
      unsubChunk();
      unsubSession();
    };
  }, [ipc, queryClient, store]);

  const autoStartInFlightRef = useRef(new Set<string>());

  const autoStartCardsGeneration = useCallback(
    (sessionId: number, snapshotTopics: ReadonlyArray<ForgeTopicCardsSummary>) => {
      const { selectedTopicKeys, topicGroups } = store.getSnapshot().context;

      const selectedTopicIds: number[] = [];
      for (const group of topicGroups) {
        for (const topic of group.topics) {
          if (selectedTopicKeys.has(topicKey(topic.topicId))) {
            selectedTopicIds.push(topic.topicId);
          }
        }
      }

      const summaryByKey = new Map<string, ForgeTopicCardsSummary>();
      for (const t of snapshotTopics) {
        summaryByKey.set(topicKey(t.topicId), t);
      }

      if (selectedTopicIds.some((id) => (summaryByKey.get(topicKey(id))?.cardCount ?? 0) > 0)) {
        return;
      }

      const toGenerate = selectedTopicIds
        .filter((id) => summaryByKey.get(topicKey(id))?.status !== "generating")
        .slice(0, 3);

      for (const topicId of toGenerate) {
        const scopedKey = `${sessionId}:${topicKey(topicId)}`;
        if (autoStartInFlightRef.current.has(scopedKey)) continue;
        autoStartInFlightRef.current.add(scopedKey);

        const existing = summaryByKey.get(topicKey(topicId));
        if (existing) {
          queryClient.setQueryData<{ topics: ReadonlyArray<ForgeTopicCardsSummary> }>(
            queryKeys.forgeCardsSnapshot(sessionId),
            (previous) => {
              if (!previous) return previous;
              return {
                topics: previous.topics.map((t) =>
                  t.topicId === topicId
                    ? { ...t, status: "generating" as const, errorMessage: null }
                    : t,
                ),
              };
            },
          );
        }

        void runIpcEffect(
          ipc.client
            .ForgeGenerateTopicCards({ sessionId, topicId })
            .pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
            ),
        )
          .then((result) => {
            queryClient.setQueryData(queryKeys.forgeTopicCards(sessionId, topicId), () => result);
            queryClient.setQueryData<{ topics: ReadonlyArray<ForgeTopicCardsSummary> }>(
              queryKeys.forgeCardsSnapshot(sessionId),
              (previous) => {
                if (!previous) return previous;
                const nextTopics = previous.topics.map((t) =>
                  t.topicId === result.topic.topicId ? result.topic : t,
                );
                const exists = nextTopics.some((t) => t.topicId === result.topic.topicId);
                return { topics: exists ? nextTopics : [...previous.topics, result.topic] };
              },
            );
          })
          .catch(() => {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.forgeCardsSnapshot(sessionId),
              exact: true,
            });
          })
          .finally(() => {
            autoStartInFlightRef.current.delete(scopedKey);
          });
      }
    },
    [ipc.client, queryClient, store],
  );

  const resumingRef = useRef(false);
  const loadedInitialSessionIdRef = useRef<number | null>(null);

  const loadSessionData = useCallback(
    (session: ForgeSessionSummary) => {
      if (resumingRef.current) return;
      resumingRef.current = true;

      const selectedSource = forgeSelectedSourceFromSession(session);
      const targetStep: ForgeStep = session.cardCount > 0 ? "cards" : "topics";
      const resumeExtractState: ExtractState =
        session.cardCount > 0
          ? { status: "idle" }
          : session.status === "error"
            ? {
                status: "error",
                message: session.errorMessage ?? "Session extraction failed.",
              }
            : session.status === "extracting" ||
                session.status === "extracted" ||
                session.status === "topics_extracting"
              ? { status: "extracting" }
              : { status: "idle" };

      Promise.all([
        runIpcEffect(
          ipc.client
            .ForgeGetCardsSnapshot({ sessionId: session.id })
            .pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
            ),
        ),
        runIpcEffect(
          ipc.client
            .ForgeGetTopicExtractionSnapshot({ sessionId: session.id })
            .pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
            ),
        ),
      ])
        .then(([cardsSnapshot, topicSnapshot]) => {
          const topicGroups = topicSnapshot.groups;
          const selectedKeys = new Set<string>();

          for (const topic of cardsSnapshot.topics) {
            if (topic.selected) {
              selectedKeys.add(topicKey(topic.topicId));
            }
          }

          if (targetStep === "cards" && selectedKeys.size === 0) {
            flattenTopicGroups(topicGroups).forEach((topic) => {
              selectedKeys.add(topicKey(topic.topicId));
            });
          }

          store.send({
            type: "resumeSession",
            currentStep: targetStep,
            selectedSource,
            extractState: resumeExtractState,
            sessionId: session.id,
            targetDeckPath: session.deckPath,
            topicGroups,
            extractionOutcomes: topicSnapshot.outcomes,
            selectedTopicKeys: selectedKeys,
          });

          onSessionChangeRef.current({ id: session.id, sourceLabel: session.sourceLabel });
          void queryClient.invalidateQueries({ queryKey: queryKeys.forgeSessionList });

          if (targetStep === "cards") {
            queryClient.setQueryData(queryKeys.forgeCardsSnapshot(session.id), cardsSnapshot);
            autoStartCardsGeneration(session.id, cardsSnapshot.topics);
          }
        })
        .catch(() => {
          store.send({
            type: "resumeError",
            message: `Failed to load session data for "${session.sourceLabel}". Please try again.`,
          });
        })
        .finally(() => {
          resumingRef.current = false;
        });
    },
    [autoStartCardsGeneration, ipc.client, queryClient, store],
  );

  useEffect(() => {
    if (!initialSessionId || !sessionListQuery.data) return;
    if (loadedInitialSessionIdRef.current === initialSessionId) return;

    const match = sessionListQuery.data.sessions.find((s) => s.id === initialSessionId);
    if (!match) {
      onSessionChangeRef.current(null);
      return;
    }

    loadedInitialSessionIdRef.current = initialSessionId;
    loadSessionData(match);
  }, [initialSessionId, sessionListQuery.data, loadSessionData]);

  const extractionMutation = useMutation({
    mutationFn: ({
      source,
    }: {
      readonly source: ForgeSourceInput;
      readonly sourceCacheKey: string;
    }) =>
      runIpcEffect(
        ipc.client
          .ForgeStartTopicExtraction({
            source,
          })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
    onMutate: () => {
      store.send({ type: "setExtracting", startedAt: new Date().toISOString() });
    },
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.forgeSessionList, exact: true });

      const snapshot = store.getSnapshot().context;
      const currentSourceCacheKey = forgeSelectedSourceCacheKey(snapshot.selectedSource);
      if (currentSourceCacheKey !== variables.sourceCacheKey) return;
      if (snapshot.extractState.status !== "extracting") return;

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: result.duplicateOfSessionId,
        extraction: result.extraction,
        groups: result.groups,
        outcomes: result.outcomes,
      });

      const updatedSessionId = store.getSnapshot().context.activeExtractionSessionId;
      if (updatedSessionId !== null) {
        onSessionChangeRef.current({
          id: updatedSessionId,
          sourceLabel: result.session.sourceLabel,
        });
      }
    },
    onError: (error, variables) => {
      const snapshot = store.getSnapshot().context;
      const currentSourceCacheKey = forgeSelectedSourceCacheKey(snapshot.selectedSource);
      if (currentSourceCacheKey !== variables.sourceCacheKey) return;
      if (snapshot.extractState.status !== "extracting") return;

      store.send({
        type: "extractionError",
        message: error.message,
      });
    },
  });
  const startTopicExtractionMutation = extractionMutation.mutate;

  const handleFileSelected = useCallback(
    (file: File | null) => {
      if (!file) {
        store.send({ type: "resetForNoSource" });
        return;
      }

      const selectedSourceFilePath = window.desktopHost.getPathForFile(file);
      if (selectedSourceFilePath.length === 0) {
        store.send({
          type: "setSourceSelectionError",
          message: "Unable to resolve a local file path for the selected PDF.",
        });
        return;
      }

      const nextSelectedSource = createPdfSelectedSource({
        sourceLabel: file.name,
        sourceFilePath: selectedSourceFilePath,
      });
      const previousSourceCacheKey = forgeSelectedSourceCacheKey(
        store.getSnapshot().context.selectedSource,
      );
      const nextSourceInput = toForgeSourceInput(nextSelectedSource);

      store.send({
        type: "setSelectedSource",
        selectedSource: nextSelectedSource,
      });

      if (
        previousSourceCacheKey !== null &&
        previousSourceCacheKey === forgeSourceCacheKey(nextSourceInput)
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.forgePreview(nextSourceInput),
          exact: true,
        });
      }
    },
    [queryClient, store],
  );

  const openTextEditor = useCallback(() => {
    store.send({ type: "openTextEditor" });
  }, [store]);

  const resetForNoSource = useCallback(() => {
    store.send({ type: "resetForNoSource" });
  }, [store]);

  const setTextDraft = useCallback(
    (text: string) => {
      store.send({ type: "setTextDraft", text });
    },
    [store],
  );

  const setTextTitleDraft = useCallback(
    (title: string) => {
      store.send({ type: "setTextTitleDraft", title });
    },
    [store],
  );

  const submitTextSource = useCallback(() => {
    const snapshot = store.getSnapshot().context;
    if (snapshot.extractState.status === "extracting") return;
    if (snapshot.textDraft.trim().length === 0) return;

    const trimmedTitle = snapshot.textTitleDraft.trim();
    const selectedSource = createTextSelectedSource({
      ...(trimmedTitle ? { sourceLabel: trimmedTitle } : {}),
      text: snapshot.textDraft,
    });
    const source = toForgeSourceInput(selectedSource);
    const sourceCacheKey = source ? forgeSourceCacheKey(source) : null;
    if (!source || !sourceCacheKey) return;

    store.send({ type: "setSelectedSource", selectedSource });
    startTopicExtractionMutation({
      source,
      sourceCacheKey,
    });
  }, [startTopicExtractionMutation, store]);

  const beginExtraction = useCallback(() => {
    const snapshot = store.getSnapshot().context;
    if (
      !snapshot.selectedSource ||
      snapshot.selectedSource.kind !== "pdf" ||
      snapshot.extractState.status === "extracting" ||
      snapshot.sourceEntryMode !== "picker"
    ) {
      return;
    }

    const source = toForgeSourceInput(snapshot.selectedSource);
    const sourceCacheKey = source ? forgeSourceCacheKey(source) : null;
    if (!source || !sourceCacheKey) return;

    startTopicExtractionMutation({
      source,
      sourceCacheKey,
    });
  }, [startTopicExtractionMutation, store]);

  const advanceToCards = useCallback(() => {
    const snapshot = store.getSnapshot().context;
    if (snapshot.extractState.status === "extracting") return;
    if (snapshot.selectedTopicKeys.size === 0) return;
    if (snapshot.activeExtractionSessionId == null) return;

    const sessionId = snapshot.activeExtractionSessionId;
    const topicIds = Array.from(snapshot.selectedTopicKeys)
      .map((key) => Number(key))
      .filter((id) => Number.isFinite(id) && id > 0);

    runIpcEffect(
      ipc.client
        .ForgeSaveTopicSelections({ sessionId, topicIds })
        .pipe(
          Effect.catchTag("RpcDefectError", (rpcDefect) =>
            Effect.fail(toRpcDefectError(rpcDefect)),
          ),
        ),
    )
      .then(() => {
        store.send({ type: "advanceToCards" });
      })
      .catch(() => {
        store.send({ type: "advanceToCards" });
      })
      .then(() =>
        runIpcEffect(
          ipc.client
            .ForgeGetCardsSnapshot({ sessionId })
            .pipe(
              Effect.catchTag("RpcDefectError", (rpcDefect) =>
                Effect.fail(toRpcDefectError(rpcDefect)),
              ),
            ),
        ),
      )
      .then((snapshotResult) => {
        queryClient.setQueryData(queryKeys.forgeCardsSnapshot(sessionId), snapshotResult);
        autoStartCardsGeneration(sessionId, snapshotResult.topics);
      })
      .catch(() => undefined);
  }, [autoStartCardsGeneration, ipc.client, queryClient, store]);

  const actions = useMemo(
    () => ({
      handleFileSelected,
      openTextEditor,
      closeTextEditor: resetForNoSource,
      setTextDraft,
      setTextTitleDraft,
      submitTextSource,
      beginExtraction,
      advanceToCards,
      resumeSession: loadSessionData,
    }),
    [
      handleFileSelected,
      openTextEditor,
      resetForNoSource,
      setTextDraft,
      setTextTitleDraft,
      submitTextSource,
      beginExtraction,
      advanceToCards,
      loadSessionData,
    ],
  );

  const value = useMemo(
    () => ({
      store,
      actions,
    }),
    [store, actions],
  );

  return <ForgePageContext.Provider value={value}>{children}</ForgePageContext.Provider>;
}
