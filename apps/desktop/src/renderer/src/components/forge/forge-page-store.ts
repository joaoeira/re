import { createStore } from "@xstate/store";
import type { ForgeSessionStatus } from "@shared/rpc/schemas/forge";

import type { ForgeSelectedSource } from "./forge-source";

export type PreviewSummary = {
  readonly textLength: number;
  readonly totalPages: number;
  readonly chunkCount: number;
};

export type PreviewState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly summary: PreviewSummary }
  | { readonly status: "error"; readonly message: string };

export type ExtractState =
  | { readonly status: "idle" }
  | { readonly status: "extracting" }
  | { readonly status: "error"; readonly message: string };

export type ExtractSummary = {
  readonly sessionId: number;
  readonly textLength: number;
  readonly preview: string;
  readonly totalPages: number;
  readonly chunkCount: number;
};

export type ChunkTopics = {
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topics: ReadonlyArray<string>;
};

export type ForgeStep = "source" | "topics" | "cards";
export type ForgeSourceEntryMode = "picker" | "text-editor";

export const topicKey = (chunkId: number, topicIndex: number): string => `${chunkId}:${topicIndex}`;

export type TopicCardIdMap = ReadonlyMap<string, ReadonlySet<number>>;
export type ForgeCardExpandedPanel = "permutations" | "cloze";
export type TopicExpandedCardPanelMap = ReadonlyMap<
  string,
  ReadonlyMap<number, ForgeCardExpandedPanel>
>;

type ForgePageContext = {
  readonly currentStep: ForgeStep;
  readonly sourceEntryMode: ForgeSourceEntryMode;
  readonly selectedSource: ForgeSelectedSource | null;
  readonly textDraft: string;
  readonly textTitleDraft: string;
  readonly targetDeckPath: string | null;
  readonly duplicateOfSessionId: number | null;
  readonly previewState: PreviewState;
  readonly extractState: ExtractState;
  readonly activeExtractionStartedAt: string | null;
  readonly activeExtractionSessionId: number | null;
  readonly topicSyncErrorMessage: string | null;
  readonly extractSummary: ExtractSummary | null;
  readonly topicsByChunk: ReadonlyArray<ChunkTopics>;
  readonly selectedTopicKeys: ReadonlySet<string>;
  readonly activeTopicKey: string | null;
  readonly deletedCardIdsByTopicKey: TopicCardIdMap;
  readonly expandedCardPanelsByTopicKey: TopicExpandedCardPanelMap;
  readonly resumeErrorMessage: string | null;
};

const emptyTopicKeys: ReadonlySet<string> = new Set<string>();
const emptyTopicCardIdMap: TopicCardIdMap = new Map<string, ReadonlySet<number>>();
const emptyTopicExpandedCardPanelMap: TopicExpandedCardPanelMap = new Map<
  string,
  ReadonlyMap<number, ForgeCardExpandedPanel>
>();

const initialForgePageContext = (): ForgePageContext => ({
  currentStep: "source",
  sourceEntryMode: "picker",
  selectedSource: null,
  textDraft: "",
  textTitleDraft: "",
  targetDeckPath: null,
  duplicateOfSessionId: null,
  previewState: { status: "idle" },
  extractState: { status: "idle" },
  activeExtractionStartedAt: null,
  activeExtractionSessionId: null,
  topicSyncErrorMessage: null,
  extractSummary: null,
  topicsByChunk: [],
  selectedTopicKeys: emptyTopicKeys,
  activeTopicKey: null,
  deletedCardIdsByTopicKey: emptyTopicCardIdMap,
  expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
  resumeErrorMessage: null,
});

const extractStateFromSessionStatus = (
  status: ForgeSessionStatus,
  errorMessage: string | null,
): ExtractState => {
  switch (status) {
    case "created":
    case "extracting":
    case "extracted":
    case "topics_extracting":
      return { status: "extracting" };
    case "error":
      return {
        status: "error",
        message: errorMessage ?? "Session extraction failed.",
      };
    case "topics_extracted":
    case "generating":
    case "ready":
      return { status: "idle" };
  }
};

const sortChunks = (chunks: ReadonlyArray<ChunkTopics>): ReadonlyArray<ChunkTopics> =>
  chunks
    .slice()
    .sort(
      (left, right) => left.sequenceOrder - right.sequenceOrder || left.chunkId - right.chunkId,
    );

const pruneSelectedTopicKeys = (
  selectedTopicKeys: ReadonlySet<string>,
  topicsByChunk: ReadonlyArray<ChunkTopics>,
): ReadonlySet<string> => {
  if (selectedTopicKeys.size === 0) return selectedTopicKeys;

  const valid = new Set<string>();
  topicsByChunk.forEach((chunk) => {
    chunk.topics.forEach((_, index) => {
      valid.add(topicKey(chunk.chunkId, index));
    });
  });

  const next = new Set<string>();
  selectedTopicKeys.forEach((key) => {
    if (valid.has(key)) next.add(key);
  });

  return next.size === selectedTopicKeys.size ? selectedTopicKeys : next;
};

const pruneMapByKeys = <V>(
  source: ReadonlyMap<string, V>,
  selectedTopicKeys: ReadonlySet<string>,
  cloneValue: (value: V) => V,
): ReadonlyMap<string, V> => {
  if (source.size === 0) return source;

  const next = new Map<string, V>();
  source.forEach((value, key) => {
    if (!selectedTopicKeys.has(key)) return;
    if (value instanceof Set || value instanceof Map) {
      if (value.size === 0) return;
    }
    next.set(key, cloneValue(value));
  });

  return next.size === source.size ? source : next;
};

const pruneTopicCardIdMap = (
  source: TopicCardIdMap,
  selectedTopicKeys: ReadonlySet<string>,
): TopicCardIdMap => pruneMapByKeys(source, selectedTopicKeys, (cardIds) => new Set(cardIds));

const pruneExpandedCardPanelMap = (
  source: TopicExpandedCardPanelMap,
  selectedTopicKeys: ReadonlySet<string>,
): TopicExpandedCardPanelMap =>
  pruneMapByKeys(source, selectedTopicKeys, (panelsByCardId) => new Map(panelsByCardId));

const withPrunedSelections = (
  context: ForgePageContext,
  selectedTopicKeys: ReadonlySet<string>,
): Pick<
  ForgePageContext,
  | "selectedTopicKeys"
  | "activeTopicKey"
  | "deletedCardIdsByTopicKey"
  | "expandedCardPanelsByTopicKey"
> => ({
  selectedTopicKeys,
  activeTopicKey:
    context.activeTopicKey && selectedTopicKeys.has(context.activeTopicKey)
      ? context.activeTopicKey
      : null,
  deletedCardIdsByTopicKey: pruneTopicCardIdMap(
    context.deletedCardIdsByTopicKey,
    selectedTopicKeys,
  ),
  expandedCardPanelsByTopicKey: pruneExpandedCardPanelMap(
    context.expandedCardPanelsByTopicKey,
    selectedTopicKeys,
  ),
});

const withTopicCardId = (
  source: TopicCardIdMap,
  topicKeyValue: string,
  cardId: number,
): TopicCardIdMap => {
  const existing = source.get(topicKeyValue);
  const nextSet = new Set(existing ?? []);
  nextSet.add(cardId);
  const nextMap = new Map(source);
  nextMap.set(topicKeyValue, nextSet);
  return nextMap;
};

const withoutTopicCardId = (
  source: TopicCardIdMap,
  topicKeyValue: string,
  cardId: number,
): TopicCardIdMap => {
  const existing = source.get(topicKeyValue);
  if (!existing || !existing.has(cardId)) return source;

  const nextSet = new Set(existing);
  nextSet.delete(cardId);
  const nextMap = new Map(source);
  if (nextSet.size === 0) {
    nextMap.delete(topicKeyValue);
  } else {
    nextMap.set(topicKeyValue, nextSet);
  }
  return nextMap;
};

const withExpandedCardPanel = (
  source: TopicExpandedCardPanelMap,
  topicKeyValue: string,
  cardId: number,
  panel: ForgeCardExpandedPanel | null,
): TopicExpandedCardPanelMap => {
  const nextByCardId = new Map(source.get(topicKeyValue) ?? []);
  if (panel === null) {
    nextByCardId.delete(cardId);
  } else {
    nextByCardId.set(cardId, panel);
  }

  const nextMap = new Map(source);
  if (nextByCardId.size === 0) {
    nextMap.delete(topicKeyValue);
  } else {
    nextMap.set(topicKeyValue, nextByCardId);
  }
  return nextMap;
};

const withoutExpandedCardPanelsForTopic = (
  source: TopicExpandedCardPanelMap,
  topicKeyValue: string,
): TopicExpandedCardPanelMap => {
  if (!source.has(topicKeyValue)) return source;
  const nextMap = new Map(source);
  nextMap.delete(topicKeyValue);
  return nextMap;
};

const mergeChunkTopics = (
  current: ReadonlyArray<ChunkTopics>,
  chunk: ChunkTopics,
): ReadonlyArray<ChunkTopics> => {
  const index = current.findIndex((entry) => entry.chunkId === chunk.chunkId);
  if (index < 0) return sortChunks([...current, chunk]);
  const next = current.slice();
  next[index] = chunk;
  return sortChunks(next);
};

const mergeTopicSnapshots = (
  current: ReadonlyArray<ChunkTopics>,
  incoming: ReadonlyArray<ChunkTopics>,
): ReadonlyArray<ChunkTopics> => {
  const byChunkId = new Map<number, ChunkTopics>();
  for (const chunk of current) {
    byChunkId.set(chunk.chunkId, chunk);
  }

  for (const chunk of incoming) {
    const existing = byChunkId.get(chunk.chunkId);
    // For one session/chunk, topic extraction is monotonic: once a chunk has N topics,
    // later snapshots should not have fewer unless data is stale.
    if (!existing || chunk.topics.length >= existing.topics.length) {
      byChunkId.set(chunk.chunkId, chunk);
    }
  }

  return sortChunks(Array.from(byChunkId.values()));
};

export const createForgePageStore = () =>
  createStore({
    context: initialForgePageContext(),
    on: {
      resetForNoSource: () => initialForgePageContext(),
      setSourceSelectionError: (_context, event: { message: string }) => ({
        ...initialForgePageContext(),
        previewState: {
          status: "error" as const,
          message: event.message,
        },
      }),
      openTextEditor: (context) => ({
        ...initialForgePageContext(),
        sourceEntryMode: "text-editor" as const,
        textDraft:
          context.selectedSource?.kind === "text" && context.selectedSource.text !== null
            ? context.selectedSource.text
            : context.textDraft,
        textTitleDraft: context.textTitleDraft,
      }),
      setTextDraft: (context, event: { text: string }) => ({
        ...context,
        sourceEntryMode: "text-editor" as const,
        textDraft: event.text,
        selectedSource:
          context.selectedSource?.kind === "text"
            ? {
                ...context.selectedSource,
                text: event.text,
              }
            : context.selectedSource,
        previewState: { status: "idle" as const },
        extractState:
          context.extractState.status === "error"
            ? ({ status: "idle" } as const)
            : context.extractState,
      }),
      setTextTitleDraft: (context, event: { title: string }) => ({
        ...context,
        textTitleDraft: event.title,
      }),
      setSelectedSource: (context, event: { selectedSource: ForgeSelectedSource }) => ({
        ...context,
        currentStep: "source" as const,
        sourceEntryMode:
          event.selectedSource.kind === "text" ? ("text-editor" as const) : ("picker" as const),
        selectedSource: event.selectedSource,
        textDraft:
          event.selectedSource.kind === "text"
            ? (event.selectedSource.text ?? context.textDraft)
            : "",
        targetDeckPath: null,
        duplicateOfSessionId: null,
        previewState:
          event.selectedSource.kind === "pdf"
            ? ({ status: "loading" } as const)
            : ({ status: "idle" } as const),
        extractState: { status: "idle" as const },
        activeExtractionStartedAt: null,
        activeExtractionSessionId: null,
        topicSyncErrorMessage: null,
        extractSummary: null,
        topicsByChunk: [],
        selectedTopicKeys: emptyTopicKeys,
        activeTopicKey: null,
        deletedCardIdsByTopicKey: emptyTopicCardIdMap,
        expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
        resumeErrorMessage: null,
      }),
      previewReady: (context, event: { summary: PreviewSummary }) => ({
        ...context,
        previewState: {
          status: "ready" as const,
          summary: event.summary,
        },
      }),
      previewError: (context, event: { message: string }) => ({
        ...context,
        previewState: {
          status: "error" as const,
          message: event.message,
        },
      }),
      setExtracting: (context, event: { startedAt: string }) => ({
        ...context,
        currentStep: "topics" as const,
        targetDeckPath: null,
        duplicateOfSessionId: null,
        activeExtractionStartedAt: event.startedAt,
        activeExtractionSessionId: null,
        topicSyncErrorMessage: null,
        extractState: { status: "extracting" as const },
        extractSummary: null,
        topicsByChunk: [],
        selectedTopicKeys: emptyTopicKeys,
        activeTopicKey: null,
        deletedCardIdsByTopicKey: emptyTopicCardIdMap,
        expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
      }),
      extractionSessionCreated: (context, event: { sessionId: number }) => {
        if (context.extractState.status !== "extracting") return context;
        if (context.activeExtractionSessionId !== null) return context;
        return {
          ...context,
          activeExtractionSessionId: event.sessionId,
        };
      },
      topicChunkExtracted: (
        context,
        event: {
          chunk: ChunkTopics;
        },
      ) => {
        const nextTopicsByChunk = mergeChunkTopics(context.topicsByChunk, event.chunk);
        const nextSelectedTopicKeys = pruneSelectedTopicKeys(
          context.selectedTopicKeys,
          nextTopicsByChunk,
        );
        return {
          ...context,
          topicsByChunk: nextTopicsByChunk,
          ...withPrunedSelections(context, nextSelectedTopicKeys),
        };
      },
      topicSnapshotSynced: (
        context,
        event: {
          sessionId: number;
          sessionCreatedAt: string;
          sessionStatus: ForgeSessionStatus;
          sessionErrorMessage: string | null;
          topicsByChunk: ReadonlyArray<ChunkTopics>;
        },
      ) => {
        if (
          context.activeExtractionSessionId !== null &&
          context.activeExtractionSessionId !== event.sessionId
        ) {
          return context;
        }

        if (
          context.activeExtractionSessionId === null &&
          context.extractState.status === "extracting" &&
          context.activeExtractionStartedAt &&
          Date.parse(event.sessionCreatedAt) < Date.parse(context.activeExtractionStartedAt)
        ) {
          return context;
        }

        const nextTopicsByChunk = mergeTopicSnapshots(context.topicsByChunk, event.topicsByChunk);
        const nextSelectedTopicKeys = pruneSelectedTopicKeys(
          context.selectedTopicKeys,
          nextTopicsByChunk,
        );
        const nextExtractState = extractStateFromSessionStatus(
          event.sessionStatus,
          event.sessionErrorMessage,
        );
        const guardedExtractState =
          context.extractSummary !== null &&
          context.extractState.status !== "extracting" &&
          nextExtractState.status === "extracting"
            ? context.extractState
            : nextExtractState;

        return {
          ...context,
          activeExtractionSessionId: event.sessionId,
          activeExtractionStartedAt:
            guardedExtractState.status === "extracting" ? context.activeExtractionStartedAt : null,
          topicSyncErrorMessage: null,
          extractState: guardedExtractState,
          topicsByChunk: nextTopicsByChunk,
          ...withPrunedSelections(context, nextSelectedTopicKeys),
        };
      },
      topicSnapshotError: (context, event: { message: string }) => ({
        ...context,
        topicSyncErrorMessage: event.message,
      }),
      extractionSuccess: (
        context,
        event: {
          duplicateOfSessionId: number | null;
          extraction: ExtractSummary;
          topicsByChunk: ReadonlyArray<ChunkTopics>;
        },
      ) => {
        const nextTopicsByChunk = sortChunks(event.topicsByChunk);
        const nextSelectedTopicKeys = pruneSelectedTopicKeys(
          context.selectedTopicKeys,
          nextTopicsByChunk,
        );
        return {
          ...context,
          currentStep: "topics" as const,
          sourceEntryMode:
            context.selectedSource?.kind === "text"
              ? ("text-editor" as const)
              : ("picker" as const),
          textDraft: "",
          textTitleDraft: "",
          targetDeckPath: null,
          duplicateOfSessionId: event.duplicateOfSessionId,
          activeExtractionStartedAt: null,
          activeExtractionSessionId: event.extraction.sessionId,
          topicSyncErrorMessage: null,
          extractSummary: event.extraction,
          topicsByChunk: nextTopicsByChunk,
          extractState: { status: "idle" as const },
          ...withPrunedSelections(context, nextSelectedTopicKeys),
        };
      },
      extractionError: (context, event: { message: string }) => ({
        ...context,
        currentStep: "source" as const,
        sourceEntryMode:
          context.selectedSource?.kind === "text" ? ("text-editor" as const) : ("picker" as const),
        textDraft:
          context.selectedSource?.kind === "text" && context.selectedSource.text !== null
            ? context.selectedSource.text
            : context.textDraft,
        textTitleDraft:
          context.selectedSource?.kind === "text"
            ? (context.selectedSource.sourceLabel ?? context.textTitleDraft)
            : "",
        targetDeckPath: null,
        activeExtractionStartedAt: null,
        activeExtractionSessionId: null,
        topicSyncErrorMessage: null,
        extractState: {
          status: "error" as const,
          message: event.message,
        },
        activeTopicKey: null,
        deletedCardIdsByTopicKey: emptyTopicCardIdMap,
        expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
      }),
      toggleTopic: (context, event: { chunkId: number; topicIndex: number }) => {
        const key = topicKey(event.chunkId, event.topicIndex);
        const next = new Set(context.selectedTopicKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return {
          ...context,
          ...withPrunedSelections(context, next),
        };
      },
      toggleAllChunk: (context, event: { chunkId: number; select: boolean }) => {
        const chunk = context.topicsByChunk.find((c) => c.chunkId === event.chunkId);
        if (!chunk) return context;
        const next = new Set(context.selectedTopicKeys);
        chunk.topics.forEach((_, i) => {
          const key = topicKey(event.chunkId, i);
          if (event.select) next.add(key);
          else next.delete(key);
        });
        return {
          ...context,
          ...withPrunedSelections(context, next),
        };
      },
      selectAllTopics: (context) => {
        const next = new Set<string>();
        context.topicsByChunk.forEach((chunk) => {
          chunk.topics.forEach((_, i) => next.add(topicKey(chunk.chunkId, i)));
        });
        return {
          ...context,
          ...withPrunedSelections(context, next),
        };
      },
      deselectAllTopics: (context) => ({
        ...context,
        selectedTopicKeys: emptyTopicKeys,
        activeTopicKey: null,
        deletedCardIdsByTopicKey: emptyTopicCardIdMap,
        expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
      }),
      setActiveCardsTopic: (context, event: { topicKey: string | null }) => ({
        ...context,
        activeTopicKey: event.topicKey,
      }),
      setCardExpandedPanelForTopic: (
        context,
        event: {
          topicKey: string;
          cardId: number;
          panel: ForgeCardExpandedPanel | null;
        },
      ) => ({
        ...context,
        expandedCardPanelsByTopicKey: withExpandedCardPanel(
          context.expandedCardPanelsByTopicKey,
          event.topicKey,
          event.cardId,
          event.panel,
        ),
      }),
      markCardDeletedFromTopic: (context, event: { topicKey: string; cardId: number }) => ({
        ...context,
        deletedCardIdsByTopicKey: withTopicCardId(
          withoutTopicCardId(context.deletedCardIdsByTopicKey, event.topicKey, event.cardId),
          event.topicKey,
          event.cardId,
        ),
      }),
      clearTopicCuration: (context, event: { topicKey: string }) => {
        const nextDeleted = new Map(context.deletedCardIdsByTopicKey);
        nextDeleted.delete(event.topicKey);
        return {
          ...context,
          deletedCardIdsByTopicKey: nextDeleted,
          expandedCardPanelsByTopicKey: withoutExpandedCardPanelsForTopic(
            context.expandedCardPanelsByTopicKey,
            event.topicKey,
          ),
        };
      },
      advanceToCards: (context) => ({
        ...context,
        currentStep: "cards" as const,
      }),
      setTargetDeckPath: (context, event: { deckPath: string | null }) => ({
        ...context,
        targetDeckPath: event.deckPath,
      }),
      resumeSession: (
        _context,
        event: {
          currentStep: ForgeStep;
          selectedSource: ForgeSelectedSource | null;
          extractState: ExtractState;
          sessionId: number;
          targetDeckPath: string | null;
          topicsByChunk: ReadonlyArray<ChunkTopics>;
          selectedTopicKeys: ReadonlySet<string>;
        },
      ) => ({
        ...initialForgePageContext(),
        currentStep: event.currentStep,
        sourceEntryMode:
          event.selectedSource?.kind === "text" ? ("text-editor" as const) : ("picker" as const),
        selectedSource: event.selectedSource,
        targetDeckPath: event.targetDeckPath,
        activeExtractionSessionId: event.sessionId,
        extractSummary: null,
        extractState: event.extractState,
        topicsByChunk: event.topicsByChunk,
        selectedTopicKeys: event.selectedTopicKeys,
      }),
      resumeError: (context, event: { message: string }) => ({
        ...context,
        resumeErrorMessage: event.message,
      }),
    },
  });

export type ForgePageStore = ReturnType<typeof createForgePageStore>;
