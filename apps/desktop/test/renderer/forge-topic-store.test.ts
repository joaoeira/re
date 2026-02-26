import { describe, expect, it } from "vitest";

import {
  createForgePageStore,
  topicKey,
  type ChunkTopics,
  type ExtractSummary,
} from "@/components/forge/forge-page-store";

const TWO_CHUNKS: ReadonlyArray<ChunkTopics> = [
  { chunkId: 10, sequenceOrder: 0, topics: ["alpha", "beta"] },
  { chunkId: 20, sequenceOrder: 1, topics: ["gamma"] },
];

const EXTRACTION: ExtractSummary = {
  sessionId: 1,
  textLength: 500,
  preview: "preview",
  totalPages: 4,
  chunkCount: 2,
};

const storeWithTopics = (chunks = TWO_CHUNKS) => {
  const store = createForgePageStore();
  store.send({
    type: "extractionSuccess",
    duplicateOfSessionId: null,
    extraction: EXTRACTION,
    topicsByChunk: chunks,
  });
  return store;
};

const ctx = (store: ReturnType<typeof createForgePageStore>) => store.getSnapshot().context;

describe("forge-page-store topic selection", () => {
  describe("topicKey", () => {
    it("produces a deterministic string key from chunkId and topicIndex", () => {
      expect(topicKey(10, 0)).toBe("10:0");
      expect(topicKey(20, 1)).toBe("20:1");
    });
  });

  describe("initial state", () => {
    it("starts with an empty selectedTopicKeys set", () => {
      const store = createForgePageStore();
      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("starts on the source step", () => {
      const store = createForgePageStore();
      expect(ctx(store).currentStep).toBe("source");
    });

    it("starts with idle extract and preview states", () => {
      const store = createForgePageStore();
      expect(ctx(store).previewState).toEqual({ status: "idle" });
      expect(ctx(store).extractState).toEqual({ status: "idle" });
    });
  });

  describe("extractionSuccess", () => {
    it("resets selectedTopicKeys to empty", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });
      expect(ctx(store).selectedTopicKeys.size).toBe(1);

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: null,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });
      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("transitions to the topics step", () => {
      const store = storeWithTopics();
      expect(ctx(store).currentStep).toBe("topics");
    });

    it("resets extractState to idle", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting" });
      expect(ctx(store).extractState.status).toBe("extracting");

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: null,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });
      expect(ctx(store).extractState).toEqual({ status: "idle" });
    });

    it("populates topicsByChunk and extractSummary", () => {
      const store = storeWithTopics();
      expect(ctx(store).topicsByChunk).toBe(TWO_CHUNKS);
      expect(ctx(store).extractSummary).toBe(EXTRACTION);
    });

    it("stores duplicateOfSessionId when provided", () => {
      const store = createForgePageStore();
      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: 42,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });
      expect(ctx(store).duplicateOfSessionId).toBe(42);
    });
  });

  describe("toggleTopic", () => {
    it("selects a topic that was not selected", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });

      const keys = ctx(store).selectedTopicKeys;
      expect(keys.has(topicKey(10, 0))).toBe(true);
      expect(keys.size).toBe(1);
    });

    it("deselects a topic that was already selected", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });
      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });

      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("toggles topics independently across chunks", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 1 });
      store.send({ type: "toggleTopic", chunkId: 20, topicIndex: 0 });

      const keys = ctx(store).selectedTopicKeys;
      expect(keys.has(topicKey(10, 1))).toBe(true);
      expect(keys.has(topicKey(20, 0))).toBe(true);
      expect(keys.size).toBe(2);
    });

    it("adds phantom key for non-existent chunkId", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleTopic", chunkId: 999, topicIndex: 0 });

      expect(ctx(store).selectedTopicKeys.has(topicKey(999, 0))).toBe(true);
      expect(ctx(store).selectedTopicKeys.size).toBe(1);
    });
  });

  describe("toggleAllChunk", () => {
    it("selects all topics in a chunk when select=true", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleAllChunk", chunkId: 10, select: true });

      const keys = ctx(store).selectedTopicKeys;
      expect(keys.has(topicKey(10, 0))).toBe(true);
      expect(keys.has(topicKey(10, 1))).toBe(true);
      expect(keys.has(topicKey(20, 0))).toBe(false);
      expect(keys.size).toBe(2);
    });

    it("deselects all topics in a chunk when select=false", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      store.send({ type: "toggleAllChunk", chunkId: 10, select: false });

      const keys = ctx(store).selectedTopicKeys;
      expect(keys.has(topicKey(10, 0))).toBe(false);
      expect(keys.has(topicKey(10, 1))).toBe(false);
      expect(keys.has(topicKey(20, 0))).toBe(true);
      expect(keys.size).toBe(1);
    });

    it("does nothing for an unknown chunkId", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });
      store.send({ type: "toggleAllChunk", chunkId: 999, select: true });

      expect(ctx(store).selectedTopicKeys.size).toBe(1);
    });

    it("is idempotent when selecting an already-selected chunk", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleAllChunk", chunkId: 10, select: true });
      store.send({ type: "toggleAllChunk", chunkId: 10, select: true });

      expect(ctx(store).selectedTopicKeys.size).toBe(2);
    });

    it("handles a chunk with empty topics array", () => {
      const chunks: ReadonlyArray<ChunkTopics> = [
        { chunkId: 10, sequenceOrder: 0, topics: [] },
        { chunkId: 20, sequenceOrder: 1, topics: ["gamma"] },
      ];
      const store = storeWithTopics(chunks);
      store.send({ type: "toggleAllChunk", chunkId: 10, select: true });

      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });
  });

  describe("selectAllTopics", () => {
    it("selects every topic across all chunks", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });

      const keys = ctx(store).selectedTopicKeys;
      expect(keys.size).toBe(3);
      expect(keys.has(topicKey(10, 0))).toBe(true);
      expect(keys.has(topicKey(10, 1))).toBe(true);
      expect(keys.has(topicKey(20, 0))).toBe(true);
    });

    it("is idempotent", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      store.send({ type: "selectAllTopics" });

      expect(ctx(store).selectedTopicKeys.size).toBe(3);
    });

    it("produces empty set when all chunks have no topics", () => {
      const chunks: ReadonlyArray<ChunkTopics> = [{ chunkId: 10, sequenceOrder: 0, topics: [] }];
      const store = storeWithTopics(chunks);
      store.send({ type: "selectAllTopics" });

      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });
  });

  describe("deselectAllTopics", () => {
    it("clears all selections", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      store.send({ type: "deselectAllTopics" });

      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("is a no-op when nothing is selected", () => {
      const store = storeWithTopics();
      store.send({ type: "deselectAllTopics" });

      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });
  });

  describe("setSelectedPdf", () => {
    it("clears selectedTopicKeys when a new PDF is selected", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      expect(ctx(store).selectedTopicKeys.size).toBe(3);

      store.send({
        type: "setSelectedPdf",
        selectedPdf: { fileName: "new.pdf", sourceFilePath: "/new.pdf" },
      });
      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });
  });

  describe("resetForNoFile", () => {
    it("clears selectedTopicKeys on full reset", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      store.send({ type: "resetForNoFile" });

      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });
  });

  describe("setFileSelectionError", () => {
    it("clears selectedTopicKeys", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      expect(ctx(store).selectedTopicKeys.size).toBe(3);

      store.send({ type: "setFileSelectionError", message: "bad file" });
      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("resets to source step with error preview", () => {
      const store = storeWithTopics();
      store.send({ type: "setFileSelectionError", message: "bad file" });

      expect(ctx(store).currentStep).toBe("source");
      expect(ctx(store).previewState).toEqual({ status: "error", message: "bad file" });
    });
  });

  describe("setExtracting", () => {
    it("sets extractState to extracting", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting" });

      expect(ctx(store).extractState).toEqual({ status: "extracting" });
    });

    it("resets duplicateOfSessionId to null", () => {
      const store = storeWithTopics();
      expect(ctx(store).duplicateOfSessionId).toBeNull();

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: 42,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });
      expect(ctx(store).duplicateOfSessionId).toBe(42);

      store.send({ type: "setExtracting" });
      expect(ctx(store).duplicateOfSessionId).toBeNull();
    });
  });

  describe("previewReady", () => {
    it("sets preview state to ready with summary", () => {
      const store = createForgePageStore();
      const summary = { textLength: 100, totalPages: 2, chunkCount: 3 };
      store.send({ type: "previewReady", summary });

      expect(ctx(store).previewState).toEqual({ status: "ready", summary });
    });
  });

  describe("previewError", () => {
    it("sets preview state to error with message", () => {
      const store = createForgePageStore();
      store.send({ type: "previewError", message: "parse failed" });

      expect(ctx(store).previewState).toEqual({ status: "error", message: "parse failed" });
    });
  });

  describe("extractionError", () => {
    it("sets extract state to error with message", () => {
      const store = createForgePageStore();
      store.send({ type: "extractionError", message: "timeout" });

      expect(ctx(store).extractState).toEqual({ status: "error", message: "timeout" });
    });
  });
});
