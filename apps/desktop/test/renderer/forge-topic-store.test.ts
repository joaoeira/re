import { describe, expect, it } from "vitest";

import {
  createForgePageStore,
  topicKey,
  type ChunkTopics,
  type ExtractSummary,
} from "@/components/forge/forge-page-store";
import { topicsSummaryToChunkTopics } from "@/components/forge/forge-page-context";
import { createPdfSelectedSource, createTextSelectedSource } from "@/components/forge/forge-source";

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

const pdfSource = (sourceFilePath: string) =>
  createPdfSelectedSource({
    sourceLabel: sourceFilePath.split("/").pop() ?? sourceFilePath,
    sourceFilePath,
  });

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
      expect(ctx(store).sourceEntryMode).toBe("picker");
      expect(ctx(store).textDraft).toBe("");
    });

    it("starts with idle extract and preview states", () => {
      const store = createForgePageStore();
      expect(ctx(store).previewState).toEqual({ status: "idle" });
      expect(ctx(store).extractState).toEqual({ status: "idle" });
    });

    it("starts with no target deck", () => {
      const store = createForgePageStore();
      expect(ctx(store).targetDeckPath).toBeNull();
    });
  });

  describe("setTargetDeckPath", () => {
    it("stores a selected target deck path", () => {
      const store = createForgePageStore();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });

      expect(ctx(store).targetDeckPath).toBe("/workspace/decks/alpha.md");
    });

    it("allows clearing the selected target deck path", () => {
      const store = createForgePageStore();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });
      store.send({ type: "setTargetDeckPath", deckPath: null });

      expect(ctx(store).targetDeckPath).toBeNull();
    });
  });

  describe("text editor source entry", () => {
    it("opens the text editor and stores drafts", () => {
      const store = createForgePageStore();
      store.send({ type: "openTextEditor" });
      store.send({ type: "setTextDraft", text: "alpha beta" });

      expect(ctx(store).sourceEntryMode).toBe("text-editor");
      expect(ctx(store).textDraft).toBe("alpha beta");
    });

    it("returns to the text editor when text extraction fails", () => {
      const store = createForgePageStore();
      const selectedSource = createTextSelectedSource({
        sourceLabel: "Pasted text",
        text: "alpha beta",
      });

      store.send({ type: "setSelectedSource", selectedSource });
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });
      store.send({ type: "extractionError", message: "Text failed" });

      expect(ctx(store).currentStep).toBe("source");
      expect(ctx(store).sourceEntryMode).toBe("text-editor");
      expect(ctx(store).textDraft).toBe("alpha beta");
      expect(ctx(store).extractState).toEqual({ status: "error", message: "Text failed" });
    });

    it("clears the text draft after successful extraction", () => {
      const store = createForgePageStore();
      store.send({
        type: "setSelectedSource",
        selectedSource: createTextSelectedSource({
          sourceLabel: "Pasted text",
          text: "alpha beta",
        }),
      });

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: null,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });

      expect(ctx(store).sourceEntryMode).toBe("text-editor");
      expect(ctx(store).textDraft).toBe("");
    });
  });

  describe("extractionSuccess", () => {
    it("preserves selectedTopicKeys that still exist", () => {
      const store = storeWithTopics();
      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });
      expect(ctx(store).selectedTopicKeys.size).toBe(1);

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: null,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });
      expect(ctx(store).selectedTopicKeys.size).toBe(1);
    });

    it("transitions to the topics step", () => {
      const store = storeWithTopics();
      expect(ctx(store).currentStep).toBe("topics");
    });

    it("resets extractState to idle", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });
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
      expect(ctx(store).topicsByChunk).toEqual(TWO_CHUNKS);
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

    it("clears targetDeckPath defensively", () => {
      const store = createForgePageStore();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });

      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: null,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });

      expect(ctx(store).targetDeckPath).toBeNull();
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

  describe("topic updates", () => {
    it("upserts chunk topics as chunk events arrive", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({
        type: "topicChunkExtracted",
        chunk: { chunkId: 20, sequenceOrder: 1, topics: ["gamma"] },
      });
      store.send({
        type: "topicChunkExtracted",
        chunk: { chunkId: 10, sequenceOrder: 0, topics: ["alpha", "beta"] },
      });

      expect(ctx(store).topicsByChunk).toEqual([
        { chunkId: 10, sequenceOrder: 0, topics: ["alpha", "beta"] },
        { chunkId: 20, sequenceOrder: 1, topics: ["gamma"] },
      ]);
    });

    it("ignores stale topic snapshots while a fresh extraction is running", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 5,
        sessionCreatedAt: "2026-02-27T11:59:59.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 99, sequenceOrder: 0, topics: ["stale"] }],
      });

      expect(ctx(store).topicsByChunk).toEqual([]);
    });

    it("accepts a valid topic snapshot during extraction", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 7,
        sessionCreatedAt: "2026-02-27T12:00:01.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 11, sequenceOrder: 0, topics: ["alpha"] }],
      });

      expect(ctx(store).activeExtractionSessionId).toBe(7);
      expect(ctx(store).topicsByChunk).toEqual([
        { chunkId: 11, sequenceOrder: 0, topics: ["alpha"] },
      ]);
    });

    it("keeps existing chunk topics when a snapshot has fewer topics", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 8,
        sessionCreatedAt: "2026-02-27T12:00:01.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 12, sequenceOrder: 0, topics: ["alpha", "beta"] }],
      });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 8,
        sessionCreatedAt: "2026-02-27T12:00:02.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 12, sequenceOrder: 0, topics: ["alpha"] }],
      });

      expect(ctx(store).topicsByChunk).toEqual([
        { chunkId: 12, sequenceOrder: 0, topics: ["alpha", "beta"] },
      ]);
    });

    it("ignores snapshots from a different active session", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 9,
        sessionCreatedAt: "2026-02-27T12:00:01.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 10, sequenceOrder: 0, topics: ["alpha"] }],
      });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 10,
        sessionCreatedAt: "2026-02-27T12:00:02.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 11, sequenceOrder: 1, topics: ["beta"] }],
      });

      expect(ctx(store).activeExtractionSessionId).toBe(9);
      expect(ctx(store).topicsByChunk).toEqual([
        { chunkId: 10, sequenceOrder: 0, topics: ["alpha"] },
      ]);
    });

    it("stores a snapshot sync error message and clears it on successful sync", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({ type: "topicSnapshotError", message: "Snapshot fetch failed" });
      expect(ctx(store).topicSyncErrorMessage).toBe("Snapshot fetch failed");

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 9,
        sessionCreatedAt: "2026-02-27T12:00:01.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 10, sequenceOrder: 0, topics: ["alpha"] }],
      });
      expect(ctx(store).topicSyncErrorMessage).toBeNull();
    });

    it("marks extraction idle when a snapshot reports topic extraction completed", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 15,
        sessionCreatedAt: "2026-02-27T12:00:01.000Z",
        sessionStatus: "topics_extracted",
        sessionErrorMessage: null,
        topicsByChunk: [{ chunkId: 12, sequenceOrder: 0, topics: ["alpha"] }],
      });

      expect(ctx(store).extractState).toEqual({ status: "idle" });
      expect(ctx(store).activeExtractionStartedAt).toBeNull();
    });

    it("marks extraction errored when a snapshot reports a session error", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: 16,
        sessionCreatedAt: "2026-02-27T12:00:01.000Z",
        sessionStatus: "error",
        sessionErrorMessage: "Topic extraction failed",
        topicsByChunk: [],
      });

      expect(ctx(store).extractState).toEqual({
        status: "error",
        message: "Topic extraction failed",
      });
      expect(ctx(store).activeExtractionStartedAt).toBeNull();
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

  describe("setSelectedSource", () => {
    it("clears selectedTopicKeys when a new PDF is selected", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      expect(ctx(store).selectedTopicKeys.size).toBe(3);

      store.send({
        type: "setSelectedSource",
        selectedSource: pdfSource("/new.pdf"),
      });
      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("clears targetDeckPath when a new PDF is selected", () => {
      const store = storeWithTopics();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });

      store.send({
        type: "setSelectedSource",
        selectedSource: pdfSource("/new.pdf"),
      });

      expect(ctx(store).targetDeckPath).toBeNull();
    });
  });

  describe("resetForNoSource", () => {
    it("clears selectedTopicKeys on full reset", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      store.send({ type: "resetForNoSource" });

      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("clears targetDeckPath on full reset", () => {
      const store = storeWithTopics();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });
      store.send({ type: "resetForNoSource" });

      expect(ctx(store).targetDeckPath).toBeNull();
    });
  });

  describe("setSourceSelectionError", () => {
    it("clears selectedTopicKeys", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      expect(ctx(store).selectedTopicKeys.size).toBe(3);

      store.send({ type: "setSourceSelectionError", message: "bad file" });
      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("resets to source step with error preview", () => {
      const store = storeWithTopics();
      store.send({ type: "setSourceSelectionError", message: "bad file" });

      expect(ctx(store).currentStep).toBe("source");
      expect(ctx(store).previewState).toEqual({ status: "error", message: "bad file" });
    });

    it("clears targetDeckPath", () => {
      const store = storeWithTopics();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });

      store.send({ type: "setSourceSelectionError", message: "bad file" });

      expect(ctx(store).targetDeckPath).toBeNull();
    });
  });

  describe("setExtracting", () => {
    it("sets extractState to extracting", () => {
      const store = createForgePageStore();
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      expect(ctx(store).extractState).toEqual({ status: "extracting" });
      expect(ctx(store).currentStep).toBe("topics");
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

      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });
      expect(ctx(store).duplicateOfSessionId).toBeNull();
    });

    it("clears targetDeckPath", () => {
      const store = storeWithTopics();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });

      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });

      expect(ctx(store).targetDeckPath).toBeNull();
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
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });
      store.send({ type: "extractionError", message: "timeout" });

      expect(ctx(store).extractState).toEqual({ status: "error", message: "timeout" });
      expect(ctx(store).currentStep).toBe("source");
    });

    it("clears targetDeckPath", () => {
      const store = createForgePageStore();
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });
      store.send({ type: "setExtracting", startedAt: "2026-02-27T12:00:00.000Z" });
      store.send({ type: "extractionError", message: "timeout" });

      expect(ctx(store).targetDeckPath).toBeNull();
    });
  });

  describe("resumeSession", () => {
    it("resets to initial state then applies the resume payload", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      expect(ctx(store).selectedTopicKeys.size).toBe(3);

      const resumeChunks: ReadonlyArray<ChunkTopics> = [
        { chunkId: 50, sequenceOrder: 0, topics: ["resumed-alpha"] },
        { chunkId: 60, sequenceOrder: 1, topics: ["resumed-beta", "resumed-gamma"] },
      ];
      const resumeKeys = new Set([topicKey(50, 0), topicKey(60, 0), topicKey(60, 1)]);

      store.send({
        type: "resumeSession",
        currentStep: "cards",
        extractState: { status: "idle" },
        selectedSource: pdfSource("/tmp/resume.pdf"),
        sessionId: 77,
        targetDeckPath: "/workspace/decks/resume.md",
        topicsByChunk: resumeChunks,
        selectedTopicKeys: resumeKeys,
      });

      const state = ctx(store);
      expect(state.currentStep).toBe("cards");
      expect(state.selectedSource).toEqual(pdfSource("/tmp/resume.pdf"));
      expect(state.activeExtractionSessionId).toBe(77);
      expect(state.topicsByChunk).toEqual(resumeChunks);
      expect(state.selectedTopicKeys).toBe(resumeKeys);
      expect(state.targetDeckPath).toBe("/workspace/decks/resume.md");
      expect(state.extractState).toEqual({ status: "idle" });
      expect(state.extractSummary).toBeNull();
    });

    it("sets step to topics when resuming a topics session", () => {
      const store = createForgePageStore();
      store.send({
        type: "resumeSession",
        currentStep: "topics",
        extractState: { status: "idle" },
        selectedSource: pdfSource("/tmp/topics.pdf"),
        sessionId: 88,
        targetDeckPath: null,
        topicsByChunk: TWO_CHUNKS,
        selectedTopicKeys: new Set<string>(),
      });

      expect(ctx(store).currentStep).toBe("topics");
      expect(ctx(store).selectedTopicKeys.size).toBe(0);
    });

    it("can resume a text-backed session without a source file path", () => {
      const store = createForgePageStore();
      store.send({
        type: "resumeSession",
        currentStep: "topics",
        extractState: { status: "idle" },
        selectedSource: {
          kind: "text",
          sourceLabel: "Pasted text",
          text: null,
        },
        sessionId: 89,
        targetDeckPath: null,
        topicsByChunk: TWO_CHUNKS,
        selectedTopicKeys: new Set<string>(),
      });

      expect(ctx(store).selectedSource).toEqual({
        kind: "text",
        sourceLabel: "Pasted text",
        text: null,
      });
      expect(ctx(store).sourceEntryMode).toBe("text-editor");
    });

    it("keeps extraction polling active when resuming a topics_extracting session", () => {
      const store = createForgePageStore();
      store.send({
        type: "resumeSession",
        currentStep: "topics",
        extractState: { status: "extracting" },
        selectedSource: {
          kind: "text",
          sourceLabel: "Pasted text",
          text: null,
        },
        sessionId: 90,
        targetDeckPath: null,
        topicsByChunk: [],
        selectedTopicKeys: new Set<string>(),
      });

      expect(ctx(store).currentStep).toBe("topics");
      expect(ctx(store).extractState).toEqual({ status: "extracting" });
      expect(ctx(store).activeExtractionSessionId).toBe(90);
    });

    it("does not let a stale snapshot downgrade a completed extraction back to extracting", () => {
      const store = createForgePageStore();
      store.send({
        type: "extractionSuccess",
        duplicateOfSessionId: null,
        extraction: EXTRACTION,
        topicsByChunk: TWO_CHUNKS,
      });

      store.send({
        type: "topicSnapshotSynced",
        sessionId: EXTRACTION.sessionId,
        sessionCreatedAt: "2026-02-27T12:00:01.000Z",
        sessionStatus: "topics_extracting",
        sessionErrorMessage: null,
        topicsByChunk: TWO_CHUNKS,
      });

      expect(ctx(store).extractState).toEqual({ status: "idle" });
    });

    it("clears prior state from a dirty store", () => {
      const store = storeWithTopics();
      store.send({ type: "selectAllTopics" });
      store.send({ type: "setTargetDeckPath", deckPath: "/workspace/decks/alpha.md" });
      store.send({
        type: "setCardExpandedPanelForTopic",
        topicKey: topicKey(10, 0),
        cardId: 101,
        panel: "permutations",
      });
      store.send({
        type: "markCardDeletedFromTopic",
        topicKey: topicKey(10, 0),
        cardId: 101,
      });

      store.send({
        type: "resumeSession",
        currentStep: "cards",
        extractState: { status: "idle" },
        selectedSource: pdfSource("/tmp/clean.pdf"),
        sessionId: 99,
        targetDeckPath: null,
        topicsByChunk: [],
        selectedTopicKeys: new Set<string>(),
      });

      const state = ctx(store);
      expect(state.deletedCardIdsByTopicKey.size).toBe(0);
      expect(state.expandedCardPanelsByTopicKey.size).toBe(0);
      expect(state.duplicateOfSessionId).toBeNull();
      expect(state.activeTopicKey).toBeNull();
      expect(state.targetDeckPath).toBeNull();
      expect(state.topicSyncErrorMessage).toBeNull();
    });
  });

  describe("resumeError", () => {
    it("sets resumeErrorMessage", () => {
      const store = createForgePageStore();
      store.send({ type: "resumeError", message: "Load failed" });

      expect(ctx(store).resumeErrorMessage).toBe("Load failed");
    });

    it("is cleared by resumeSession", () => {
      const store = createForgePageStore();
      store.send({ type: "resumeError", message: "Load failed" });
      expect(ctx(store).resumeErrorMessage).toBe("Load failed");

      store.send({
        type: "resumeSession",
        currentStep: "cards",
        extractState: { status: "idle" },
        selectedSource: pdfSource("/f.pdf"),
        sessionId: 1,
        targetDeckPath: null,
        topicsByChunk: [],
        selectedTopicKeys: new Set<string>(),
      });

      expect(ctx(store).resumeErrorMessage).toBeNull();
    });

    it("is cleared by setSelectedSource", () => {
      const store = createForgePageStore();
      store.send({ type: "resumeError", message: "Load failed" });

      store.send({
        type: "setSelectedSource",
        selectedSource: pdfSource("/new.pdf"),
      });

      expect(ctx(store).resumeErrorMessage).toBeNull();
    });
  });

  describe("expanded card panels", () => {
    it("stores one expanded panel per card and allows switching panel types", () => {
      const store = storeWithTopics();
      const alphaKey = topicKey(10, 0);

      store.send({
        type: "setCardExpandedPanelForTopic",
        topicKey: alphaKey,
        cardId: 101,
        panel: "permutations",
      });
      expect(ctx(store).expandedCardPanelsByTopicKey.get(alphaKey)?.get(101)).toBe("permutations");

      store.send({
        type: "setCardExpandedPanelForTopic",
        topicKey: alphaKey,
        cardId: 101,
        panel: "cloze",
      });
      expect(ctx(store).expandedCardPanelsByTopicKey.get(alphaKey)?.get(101)).toBe("cloze");
    });

    it("clears expanded panels when topic curation is cleared", () => {
      const store = storeWithTopics();
      const alphaKey = topicKey(10, 0);

      store.send({
        type: "setCardExpandedPanelForTopic",
        topicKey: alphaKey,
        cardId: 101,
        panel: "permutations",
      });
      expect(ctx(store).expandedCardPanelsByTopicKey.get(alphaKey)?.get(101)).toBe("permutations");

      store.send({ type: "clearTopicCuration", topicKey: alphaKey });
      expect(ctx(store).expandedCardPanelsByTopicKey.get(alphaKey)).toBeUndefined();
    });

    it("prunes expanded panels when a topic is deselected", () => {
      const store = storeWithTopics();
      const alphaKey = topicKey(10, 0);

      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });
      store.send({
        type: "setCardExpandedPanelForTopic",
        topicKey: alphaKey,
        cardId: 101,
        panel: "permutations",
      });
      expect(ctx(store).expandedCardPanelsByTopicKey.get(alphaKey)?.get(101)).toBe("permutations");

      store.send({ type: "toggleTopic", chunkId: 10, topicIndex: 0 });
      expect(ctx(store).expandedCardPanelsByTopicKey.get(alphaKey)).toBeUndefined();
    });
  });
});

describe("topicsSummaryToChunkTopics", () => {
  const makeSummary = (overrides: {
    chunkId: number;
    sequenceOrder: number;
    topicIndex: number;
    topicText: string;
  }) => ({
    topicId: overrides.chunkId * 100 + overrides.topicIndex,
    chunkId: overrides.chunkId,
    sequenceOrder: overrides.sequenceOrder,
    topicIndex: overrides.topicIndex,
    topicText: overrides.topicText,
    status: "idle" as const,
    errorMessage: null,
    cardCount: 0,
    addedCount: 0,
    generationRevision: 0,
    selected: false,
  });

  it("groups topics by chunk and sorts by sequenceOrder then topicIndex", () => {
    const result = topicsSummaryToChunkTopics([
      makeSummary({ chunkId: 20, sequenceOrder: 1, topicIndex: 1, topicText: "beta" }),
      makeSummary({ chunkId: 10, sequenceOrder: 0, topicIndex: 0, topicText: "alpha" }),
      makeSummary({ chunkId: 20, sequenceOrder: 1, topicIndex: 0, topicText: "gamma" }),
    ]);

    expect(result).toEqual([
      { chunkId: 10, sequenceOrder: 0, topics: ["alpha"] },
      { chunkId: 20, sequenceOrder: 1, topics: ["gamma", "beta"] },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(topicsSummaryToChunkTopics([])).toEqual([]);
  });

  it("handles a single topic", () => {
    const result = topicsSummaryToChunkTopics([
      makeSummary({ chunkId: 5, sequenceOrder: 0, topicIndex: 0, topicText: "only" }),
    ]);

    expect(result).toEqual([{ chunkId: 5, sequenceOrder: 0, topics: ["only"] }]);
  });
});
