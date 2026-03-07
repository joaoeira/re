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
import { ForgeTopicChunkExtracted, ForgeExtractionSessionCreated } from "@shared/rpc/contracts";
import type {
  ForgeSessionSummary,
  ForgeSourceInput,
  ForgeTopicCardsSummary,
} from "@shared/rpc/schemas/forge";
import {
  createForgePageStore,
  type ForgeCardExpandedPanel,
  topicKey,
  type ChunkTopics,
  type ExtractState,
  type ExtractSummary,
  type ForgePageStore,
  type ForgeSourceEntryMode,
  type ForgeStep,
  type PreviewState,
  type TopicCardIdMap,
  type TopicExpandedCardPanelMap,
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

export function useForgePreviewState(): PreviewState {
  return useForgePageSelector((snapshot) => snapshot.context.previewState);
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

export function useForgeTopicsByChunk(): ReadonlyArray<ChunkTopics> {
  return useForgePageSelector((snapshot) => snapshot.context.topicsByChunk);
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

export function useForgeSelectedTopicCount(): number {
  return useForgePageSelector((snapshot) => {
    const { topicsByChunk, selectedTopicKeys } = snapshot.context;
    let count = 0;
    for (const chunk of topicsByChunk) {
      for (let i = 0; i < chunk.topics.length; i++) {
        if (selectedTopicKeys.has(topicKey(chunk.chunkId, i))) count++;
      }
    }
    return count;
  });
}

export type SelectedTopic = {
  readonly chunkId: number;
  readonly topicIndex: number;
  readonly text: string;
};

export function useForgeSelectedTopics(): ReadonlyArray<SelectedTopic> {
  return useForgePageSelector((snapshot) => {
    const { topicsByChunk, selectedTopicKeys } = snapshot.context;
    const result: SelectedTopic[] = [];
    for (const chunk of topicsByChunk) {
      for (let i = 0; i < chunk.topics.length; i++) {
        if (selectedTopicKeys.has(topicKey(chunk.chunkId, i))) {
          result.push({ chunkId: chunk.chunkId, topicIndex: i, text: chunk.topics[i]! });
        }
      }
    }
    return result;
  });
}

export type ForgeTopicActions = {
  readonly toggleTopic: (chunkId: number, topicIndex: number) => void;
  readonly toggleAllChunk: (chunkId: number, select: boolean) => void;
  readonly selectAllTopics: () => void;
  readonly deselectAllTopics: () => void;
};

export function useForgeTopicActions(): ForgeTopicActions {
  const store = useForgePageStore();
  return useMemo(
    () => ({
      toggleTopic: (chunkId: number, topicIndex: number) =>
        store.send({ type: "toggleTopic", chunkId, topicIndex }),
      toggleAllChunk: (chunkId: number, select: boolean) =>
        store.send({ type: "toggleAllChunk", chunkId, select }),
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

export function topicsSummaryToChunkTopics(
  topics: ReadonlyArray<ForgeTopicCardsSummary>,
): ReadonlyArray<ChunkTopics> {
  const byChunkId = new Map<number, { sequenceOrder: number; topics: Map<number, string> }>();
  for (const t of topics) {
    let entry = byChunkId.get(t.chunkId);
    if (!entry) {
      entry = { sequenceOrder: t.sequenceOrder, topics: new Map() };
      byChunkId.set(t.chunkId, entry);
    }
    entry.topics.set(t.topicIndex, t.topicText);
  }

  return Array.from(byChunkId.entries())
    .map(([chunkId, entry]) => ({
      chunkId,
      sequenceOrder: entry.sequenceOrder,
      topics: Array.from(entry.topics.entries())
        .sort(([a], [b]) => a - b)
        .map(([, text]) => text),
    }))
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder);
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

  const selectedSource = useSelector(store, (snapshot) => snapshot.context.selectedSource);
  const currentStep = useSelector(store, (snapshot) => snapshot.context.currentStep);
  const sourceEntryMode = useSelector(store, (snapshot) => snapshot.context.sourceEntryMode);
  const extractState = useSelector(store, (snapshot) => snapshot.context.extractState);
  const activeExtractionSessionId = useSelector(
    store,
    (snapshot) => snapshot.context.activeExtractionSessionId,
  );

  const previewSource =
    currentStep === "source" && sourceEntryMode === "picker" && selectedSource?.kind === "pdf"
      ? toForgeSourceInput(selectedSource)
      : null;
  const previewSourceCacheKey = forgeSourceCacheKey(previewSource);

  const previewQuery = useForgePreviewQuery(previewSource);
  const topicSnapshotQuery = useForgeTopicSnapshotQuery(
    currentStep === "topics" ? activeExtractionSessionId : null,
    {
      refetchIntervalMs: extractState.status === "extracting" ? 2_000 : false,
    },
  );

  useEffect(() => {
    if (!previewSourceCacheKey || !previewQuery.data) return;

    store.send({
      type: "previewReady",
      summary: previewQuery.data,
    });
  }, [previewSourceCacheKey, previewQuery.data, previewQuery.dataUpdatedAt, store]);

  useEffect(() => {
    if (!previewSourceCacheKey || !previewQuery.error) return;

    store.send({
      type: "previewError",
      message: previewQuery.error.message,
    });
  }, [previewSourceCacheKey, previewQuery.error, previewQuery.errorUpdatedAt, store]);

  useEffect(() => {
    if (activeExtractionSessionId === null || currentStep !== "topics" || !topicSnapshotQuery.data)
      return;

    store.send({
      type: "topicSnapshotSynced",
      sessionId: topicSnapshotQuery.data.session.id,
      sessionCreatedAt: topicSnapshotQuery.data.session.createdAt,
      sessionStatus: topicSnapshotQuery.data.session.status,
      sessionErrorMessage: topicSnapshotQuery.data.session.errorMessage,
      topicsByChunk: topicSnapshotQuery.data.topicsByChunk,
    });
  }, [
    currentStep,
    activeExtractionSessionId,
    topicSnapshotQuery.data,
    topicSnapshotQuery.dataUpdatedAt,
    store,
  ]);

  useEffect(() => {
    if (currentStep !== "topics" || activeExtractionSessionId === null || !topicSnapshotQuery.error)
      return;
    if (store.getSnapshot().context.extractState.status !== "extracting") return;

    store.send({
      type: "topicSnapshotError",
      message: topicSnapshotQuery.error.message,
    });
  }, [
    currentStep,
    activeExtractionSessionId,
    topicSnapshotQuery.error,
    topicSnapshotQuery.errorUpdatedAt,
    store,
  ]);

  useEffect(() => {
    return ipc.events.subscribe(ForgeTopicChunkExtracted, (event) => {
      const context = store.getSnapshot().context;

      if (context.activeExtractionSessionId === null) {
        store.send({ type: "extractionSessionCreated", sessionId: event.sessionId });
        if (store.getSnapshot().context.activeExtractionSessionId !== event.sessionId) return;
      } else if (context.activeExtractionSessionId !== event.sessionId) {
        return;
      }

      store.send({
        type: "topicChunkExtracted",
        chunk: event.chunk,
      });
    });
  }, [ipc, store]);

  useEffect(() => {
    return ipc.events.subscribe(ForgeExtractionSessionCreated, (event) => {
      store.send({
        type: "extractionSessionCreated",
        sessionId: event.sessionId,
      });

      void queryClient.invalidateQueries({ queryKey: queryKeys.forgeSessionList, exact: true });
    });
  }, [ipc, queryClient, store]);

  const resumingRef = useRef(false);

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

      runIpcEffect(
        ipc.client
          .ForgeGetCardsSnapshot({ sessionId: session.id })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      )
        .then((result) => {
          const topicsByChunk = topicsSummaryToChunkTopics(result.topics);
          const selectedKeys = new Set<string>();

          for (const topic of result.topics) {
            if (topic.selected) {
              selectedKeys.add(topicKey(topic.chunkId, topic.topicIndex));
            }
          }

          if (targetStep === "cards" && selectedKeys.size === 0) {
            for (const chunk of topicsByChunk) {
              chunk.topics.forEach((_, index) => {
                selectedKeys.add(topicKey(chunk.chunkId, index));
              });
            }
          }

          const selectedTopicKeys: ReadonlySet<string> = selectedKeys;

          store.send({
            type: "resumeSession",
            currentStep: targetStep,
            selectedSource,
            extractState: resumeExtractState,
            sessionId: session.id,
            targetDeckPath: session.deckPath,
            topicsByChunk,
            selectedTopicKeys,
          });

          onSessionChangeRef.current({ id: session.id, sourceLabel: session.sourceLabel });
          void queryClient.invalidateQueries({ queryKey: queryKeys.forgeSessionList });
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
    [ipc.client, queryClient, store],
  );

  useEffect(() => {
    if (!initialSessionId || !sessionListQuery.data) return;

    const match = sessionListQuery.data.sessions.find((s) => s.id === initialSessionId);
    if (!match) {
      onSessionChangeRef.current(null);
      return;
    }

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
        topicsByChunk: result.topicsByChunk,
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
    const selections: Array<{ chunkId: number; topicIndex: number }> = [];
    for (const key of snapshot.selectedTopicKeys) {
      const parts = key.split(":");
      const chunkId = Number(parts[0]);
      const topicIndex = Number(parts[1]);
      if (!Number.isFinite(chunkId) || !Number.isFinite(topicIndex)) continue;
      selections.push({ chunkId, topicIndex });
    }

    runIpcEffect(
      ipc.client
        .ForgeSaveTopicSelections({ sessionId, selections })
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
      });
  }, [ipc.client, store]);

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
