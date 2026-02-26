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
  extractSummary: null,
  topicsByChunk: [],
  selectedTopicKeys: emptyTopicKeys,
});

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
      setExtracting: (context) => ({
        ...context,
        duplicateOfSessionId: null,
        extractState: { status: "extracting" as const },
      }),
      extractionSuccess: (
        context,
        event: {
          duplicateOfSessionId: number | null;
          extraction: ExtractSummary;
          topicsByChunk: ReadonlyArray<ChunkTopics>;
        },
      ) => ({
        ...context,
        currentStep: "topics" as const,
        duplicateOfSessionId: event.duplicateOfSessionId,
        extractSummary: event.extraction,
        topicsByChunk: event.topicsByChunk,
        extractState: { status: "idle" as const },
        selectedTopicKeys: emptyTopicKeys,
      }),
      extractionError: (context, event: { message: string }) => ({
        ...context,
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
