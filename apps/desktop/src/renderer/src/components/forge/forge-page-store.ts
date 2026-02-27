import { createStore } from "@xstate/store";

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

export type ForgeStep = "source" | "topics";

export type SelectedPdf = {
  readonly fileName: string;
  readonly sourceFilePath: string;
};

export const topicKey = (chunkId: number, topicIndex: number): string => `${chunkId}:${topicIndex}`;

type ForgePageContext = {
  readonly currentStep: ForgeStep;
  readonly selectedPdf: SelectedPdf | null;
  readonly duplicateOfSessionId: number | null;
  readonly previewState: PreviewState;
  readonly extractState: ExtractState;
  readonly activeExtractionStartedAt: string | null;
  readonly activeExtractionSessionId: number | null;
  readonly topicSyncErrorMessage: string | null;
  readonly extractSummary: ExtractSummary | null;
  readonly topicsByChunk: ReadonlyArray<ChunkTopics>;
  readonly selectedTopicKeys: ReadonlySet<string>;
};

const emptyTopicKeys: ReadonlySet<string> = new Set<string>();

const initialForgePageContext = (): ForgePageContext => ({
  currentStep: "source",
  selectedPdf: null,
  duplicateOfSessionId: null,
  previewState: { status: "idle" },
  extractState: { status: "idle" },
  activeExtractionStartedAt: null,
  activeExtractionSessionId: null,
  topicSyncErrorMessage: null,
  extractSummary: null,
  topicsByChunk: [],
  selectedTopicKeys: emptyTopicKeys,
});

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
      resetForNoFile: () => initialForgePageContext(),
      setFileSelectionError: (_context, event: { message: string }) => ({
        ...initialForgePageContext(),
        previewState: {
          status: "error" as const,
          message: event.message,
        },
      }),
      setSelectedPdf: (context, event: { selectedPdf: SelectedPdf }) => ({
        ...context,
        currentStep: "source" as const,
        selectedPdf: event.selectedPdf,
        duplicateOfSessionId: null,
        previewState: { status: "loading" as const },
        extractState: { status: "idle" as const },
        activeExtractionStartedAt: null,
        activeExtractionSessionId: null,
        topicSyncErrorMessage: null,
        extractSummary: null,
        topicsByChunk: [],
        selectedTopicKeys: emptyTopicKeys,
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
        duplicateOfSessionId: null,
        activeExtractionStartedAt: event.startedAt,
        activeExtractionSessionId: null,
        topicSyncErrorMessage: null,
        extractState: { status: "extracting" as const },
        extractSummary: null,
        topicsByChunk: [],
        selectedTopicKeys: emptyTopicKeys,
      }),
      topicChunkExtracted: (
        context,
        event: {
          chunk: ChunkTopics;
        },
      ) => {
        const nextTopicsByChunk = mergeChunkTopics(context.topicsByChunk, event.chunk);
        return {
          ...context,
          topicsByChunk: nextTopicsByChunk,
          selectedTopicKeys: pruneSelectedTopicKeys(context.selectedTopicKeys, nextTopicsByChunk),
        };
      },
      topicSnapshotSynced: (
        context,
        event: {
          sessionId: number | null;
          sessionCreatedAt: string | null;
          topicsByChunk: ReadonlyArray<ChunkTopics>;
        },
      ) => {
        if (event.sessionId === null) {
          return context;
        }

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
          event.sessionCreatedAt &&
          Date.parse(event.sessionCreatedAt) < Date.parse(context.activeExtractionStartedAt)
        ) {
          return context;
        }

        const nextTopicsByChunk = mergeTopicSnapshots(context.topicsByChunk, event.topicsByChunk);

        return {
          ...context,
          activeExtractionSessionId: event.sessionId,
          topicSyncErrorMessage: null,
          topicsByChunk: nextTopicsByChunk,
          selectedTopicKeys: pruneSelectedTopicKeys(context.selectedTopicKeys, nextTopicsByChunk),
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
        return {
          ...context,
          currentStep: "topics" as const,
          duplicateOfSessionId: event.duplicateOfSessionId,
          activeExtractionStartedAt: null,
          activeExtractionSessionId: event.extraction.sessionId,
          topicSyncErrorMessage: null,
          extractSummary: event.extraction,
          topicsByChunk: nextTopicsByChunk,
          extractState: { status: "idle" as const },
          selectedTopicKeys: pruneSelectedTopicKeys(context.selectedTopicKeys, nextTopicsByChunk),
        };
      },
      extractionError: (context, event: { message: string }) => ({
        ...context,
        currentStep: "source" as const,
        activeExtractionStartedAt: null,
        activeExtractionSessionId: null,
        topicSyncErrorMessage: null,
        extractState: {
          status: "error" as const,
          message: event.message,
        },
      }),
      toggleTopic: (context, event: { chunkId: number; topicIndex: number }) => {
        const key = topicKey(event.chunkId, event.topicIndex);
        const next = new Set(context.selectedTopicKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...context, selectedTopicKeys: next };
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
        return { ...context, selectedTopicKeys: next };
      },
      selectAllTopics: (context) => {
        const next = new Set<string>();
        context.topicsByChunk.forEach((chunk) => {
          chunk.topics.forEach((_, i) => next.add(topicKey(chunk.chunkId, i)));
        });
        return { ...context, selectedTopicKeys: next };
      },
      deselectAllTopics: (context) => ({
        ...context,
        selectedTopicKeys: emptyTopicKeys,
      }),
    },
  });

export type ForgePageStore = ReturnType<typeof createForgePageStore>;
