import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { Effect } from "effect";

import { useForgePreviewQuery } from "@/hooks/queries/use-forge-preview-query";
import { useForgeSessionListQuery } from "@/hooks/queries/use-forge-session-list-query";
import { useForgeTopicSnapshotQuery } from "@/hooks/queries/use-forge-topic-snapshot-query";
import { useIpc } from "@/lib/ipc-context";
import { runIpcEffect, toRpcDefectError } from "@/lib/ipc-query";
import { queryKeys } from "@/lib/query-keys";
import { ForgeTopicChunkExtracted } from "@shared/rpc/contracts";
import type { ForgeSessionSummary, ForgeTopicCardsSummary } from "@shared/rpc/schemas/forge";
import {
  createForgePageStore,
  type ForgeCardExpandedPanel,
  topicKey,
  type ChunkTopics,
  type ExtractState,
  type ExtractSummary,
  type ForgePageStore,
  type ForgeStep,
  type PreviewState,
  type SelectedPdf,
  type TopicCardIdMap,
  type TopicExpandedCardPanelMap,
} from "./forge-page-store";

type ForgePageActions = {
  readonly handleFileSelected: (file: File | null) => void;
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

export function useForgeSelectedPdf(): SelectedPdf | null {
  return useForgePageSelector((snapshot) => snapshot.context.selectedPdf);
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

export function useForgeAddedCardIdsByTopicKey(): TopicCardIdMap {
  return useForgePageSelector((snapshot) => snapshot.context.addedCardIdsByTopicKey);
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
  readonly markCardAdded: (topicKey: string, cardId: number) => void;
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
      markCardAdded: (topicKey: string, cardId: number) =>
        store.send({ type: "markCardAddedToTopic", topicKey, cardId }),
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
  readonly onSessionChange: (session: { id: number; fileName: string } | null) => void;
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

  const selectedPdf = useSelector(store, (snapshot) => snapshot.context.selectedPdf);
  const sourceFilePath = selectedPdf?.sourceFilePath ?? null;
  const currentStep = useSelector(store, (snapshot) => snapshot.context.currentStep);
  const extractState = useSelector(store, (snapshot) => snapshot.context.extractState);

  const previewQuery = useForgePreviewQuery(sourceFilePath);
  const topicSnapshotQuery = useForgeTopicSnapshotQuery(
    currentStep === "topics" ? sourceFilePath : null,
    {
      refetchIntervalMs: extractState.status === "extracting" ? 2_000 : false,
    },
  );

  useEffect(() => {
    if (!sourceFilePath || !previewQuery.data) return;

    store.send({
      type: "previewReady",
      summary: previewQuery.data,
    });
  }, [sourceFilePath, previewQuery.data, previewQuery.dataUpdatedAt, store]);

  useEffect(() => {
    if (!sourceFilePath || !previewQuery.error) return;

    store.send({
      type: "previewError",
      message: previewQuery.error.message,
    });
  }, [sourceFilePath, previewQuery.error, previewQuery.errorUpdatedAt, store]);

  useEffect(() => {
    if (!sourceFilePath || currentStep !== "topics" || !topicSnapshotQuery.data) return;

    const currentSourcePath = store.getSnapshot().context.selectedPdf?.sourceFilePath;
    if (currentSourcePath !== sourceFilePath) return;

    store.send({
      type: "topicSnapshotSynced",
      sessionId: topicSnapshotQuery.data.session?.id ?? null,
      sessionCreatedAt: topicSnapshotQuery.data.session?.createdAt ?? null,
      topicsByChunk: topicSnapshotQuery.data.topicsByChunk,
    });
  }, [
    currentStep,
    sourceFilePath,
    topicSnapshotQuery.data,
    topicSnapshotQuery.dataUpdatedAt,
    store,
  ]);

  useEffect(() => {
    if (currentStep !== "topics" || !sourceFilePath || !topicSnapshotQuery.error) return;
    if (store.getSnapshot().context.extractState.status !== "extracting") return;

    const currentSourcePath = store.getSnapshot().context.selectedPdf?.sourceFilePath;
    if (currentSourcePath !== sourceFilePath) return;

    store.send({
      type: "topicSnapshotError",
      message: topicSnapshotQuery.error.message,
    });
  }, [
    currentStep,
    sourceFilePath,
    topicSnapshotQuery.error,
    topicSnapshotQuery.errorUpdatedAt,
    store,
  ]);

  useEffect(() => {
    return ipc.events.subscribe(ForgeTopicChunkExtracted, (event) => {
      const context = store.getSnapshot().context;
      const currentSourcePath = context.selectedPdf?.sourceFilePath;
      if (currentSourcePath !== event.sourceFilePath) return;
      if (context.activeExtractionSessionId === null) return;
      if (context.activeExtractionSessionId !== event.sessionId) return;

      store.send({
        type: "topicChunkExtracted",
        chunk: event.chunk,
      });
    });
  }, [ipc, store]);

  const resumingRef = useRef(false);

  const loadSessionData = useCallback(
    (session: ForgeSessionSummary) => {
      if (resumingRef.current) return;
      resumingRef.current = true;

      const fileName = session.sourceFilePath.split("/").pop() ?? session.sourceFilePath;
      const targetStep: ForgeStep = session.cardCount > 0 ? "cards" : "topics";

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
            selectedPdf: { fileName, sourceFilePath: session.sourceFilePath },
            sessionId: session.id,
            targetDeckPath: session.deckPath,
            topicsByChunk,
            selectedTopicKeys,
          });

          onSessionChangeRef.current({ id: session.id, fileName });
          void queryClient.invalidateQueries({ queryKey: queryKeys.forgeSessionList });
        })
        .catch(() => {
          store.send({
            type: "resumeError",
            message: `Failed to load session data for "${fileName}". Please try again.`,
          });
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
    mutationFn: ({ selectedSourceFilePath }: { selectedSourceFilePath: string }) =>
      runIpcEffect(
        ipc.client
          .ForgeStartTopicExtraction({
            sourceFilePath: selectedSourceFilePath,
          })
          .pipe(
            Effect.catchTag("RpcDefectError", (rpcDefect) =>
              Effect.fail(toRpcDefectError(rpcDefect)),
            ),
          ),
      ),
    onMutate: ({ selectedSourceFilePath }) => {
      store.send({ type: "setExtracting", startedAt: new Date().toISOString() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.forgeTopicSnapshot(selectedSourceFilePath),
        exact: true,
      });
    },
    onSuccess: (result, variables) => {
      const currentSourcePath = store.getSnapshot().context.selectedPdf?.sourceFilePath;
      if (currentSourcePath !== variables.selectedSourceFilePath) return;

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: result.duplicateOfSessionId,
        extraction: result.extraction,
        topicsByChunk: result.topicsByChunk,
      });
    },
    onError: (error, variables) => {
      const currentSourcePath = store.getSnapshot().context.selectedPdf?.sourceFilePath;
      if (currentSourcePath !== variables.selectedSourceFilePath) return;

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
        store.send({ type: "resetForNoFile" });
        return;
      }

      const selectedSourceFilePath = window.desktopHost.getPathForFile(file);
      if (selectedSourceFilePath.length === 0) {
        store.send({
          type: "setFileSelectionError",
          message: "Unable to resolve a local file path for the selected PDF.",
        });
        return;
      }

      const previousSourceFilePath =
        store.getSnapshot().context.selectedPdf?.sourceFilePath ?? null;

      store.send({
        type: "setSelectedPdf",
        selectedPdf: {
          fileName: file.name,
          sourceFilePath: selectedSourceFilePath,
        },
      });

      if (previousSourceFilePath === selectedSourceFilePath) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.forgePreview(selectedSourceFilePath),
          exact: true,
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.forgeTopicSnapshot(selectedSourceFilePath),
          exact: true,
        });
      }
    },
    [queryClient, store],
  );

  const beginExtraction = useCallback(() => {
    const snapshot = store.getSnapshot().context;
    if (!snapshot.selectedPdf || snapshot.extractState.status === "extracting") {
      return;
    }

    startTopicExtractionMutation({
      selectedSourceFilePath: snapshot.selectedPdf.sourceFilePath,
    });
  }, [startTopicExtractionMutation, store]);

  const advanceToCards = useCallback(() => {
    const snapshot = store.getSnapshot().context;
    if (snapshot.extractState.status === "extracting") return;
    if (snapshot.selectedTopicKeys.size === 0) return;
    if (snapshot.extractSummary?.sessionId == null) return;

    const sessionId = snapshot.extractSummary.sessionId;
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

  const resumeSession = useCallback((session: ForgeSessionSummary) => {
    const fileName = session.sourceFilePath.split("/").pop() ?? session.sourceFilePath;
    onSessionChangeRef.current({ id: session.id, fileName });
  }, []);

  const actions = useMemo(
    () => ({
      handleFileSelected,
      beginExtraction,
      advanceToCards,
      resumeSession,
    }),
    [handleFileSelected, beginExtraction, advanceToCards, resumeSession],
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
