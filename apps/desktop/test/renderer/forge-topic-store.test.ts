import { describe, expect, it } from "vitest";

import {
  createForgePageStore,
  topicKey,
  type ExtractSummary,
} from "@/components/forge/forge-page-store";
import { topicSummariesToTopicGroups } from "@/components/forge/forge-page-context";
import {
  createPdfSelectedSource,
  createTextSelectedSource,
  toForgeSourceInput,
} from "@/components/forge/forge-source";
import type {
  ForgeTopicCardsSummary,
  ForgeTopicExtractionOutcome,
  ForgeTopicGroup,
} from "@shared/rpc/schemas/forge";

const EXTRACTION: ExtractSummary = {
  sessionId: 1,
  textLength: 500,
  preview: "preview",
  totalPages: 4,
  chunkCount: 2,
};

const TOPIC_SUMMARIES: ReadonlyArray<ForgeTopicCardsSummary> = [
  {
    topicId: 101,
    sessionId: 1,
    family: "detail",
    chunkId: 10,
    chunkSequenceOrder: 0,
    topicIndex: 0,
    topicText: "alpha",
    status: "idle",
    errorMessage: null,
    cardCount: 0,
    addedCount: 0,
    generationRevision: 0,
    selected: false,
  },
  {
    topicId: 102,
    sessionId: 1,
    family: "detail",
    chunkId: 10,
    chunkSequenceOrder: 0,
    topicIndex: 1,
    topicText: "beta",
    status: "idle",
    errorMessage: null,
    cardCount: 0,
    addedCount: 0,
    generationRevision: 0,
    selected: false,
  },
  {
    topicId: 201,
    sessionId: 1,
    family: "synthesis",
    chunkId: null,
    chunkSequenceOrder: null,
    topicIndex: 0,
    topicText: "cross-cutting idea",
    status: "idle",
    errorMessage: null,
    cardCount: 0,
    addedCount: 0,
    generationRevision: 0,
    selected: false,
  },
];

const TOPIC_GROUPS: ReadonlyArray<ForgeTopicGroup> = topicSummariesToTopicGroups(TOPIC_SUMMARIES);
const EXTRACTION_OUTCOMES: ReadonlyArray<ForgeTopicExtractionOutcome> = [
  {
    family: "detail",
    status: "extracted",
    errorMessage: null,
  },
  {
    family: "synthesis",
    status: "extracted",
    errorMessage: null,
  },
];

const ctx = (store: ReturnType<typeof createForgePageStore>) => store.getSnapshot().context;

const storeWithTopics = () => {
  const store = createForgePageStore();
  store.send({
    type: "extractionSuccess",
    duplicateOfSessionId: null,
    extraction: EXTRACTION,
    groups: TOPIC_GROUPS,
    outcomes: EXTRACTION_OUTCOMES,
  });
  return store;
};

describe("forge-page-store", () => {
  it("builds topic ids into deterministic keys", () => {
    expect(topicKey(101)).toBe("101");
    expect(topicKey(202)).toBe("202");
  });

  it("starts on the source step with empty topic groups", () => {
    const store = createForgePageStore();

    expect(ctx(store).currentStep).toBe("source");
    expect(ctx(store).topicGroups).toEqual([]);
    expect(ctx(store).selectedTopicKeys.size).toBe(0);
  });

  it("stores groups and outcomes after extraction success", () => {
    const store = storeWithTopics();

    expect(ctx(store).currentStep).toBe("topics");
    expect(ctx(store).topicGroups).toEqual(TOPIC_GROUPS);
    expect(ctx(store).extractionOutcomes).toEqual(EXTRACTION_OUTCOMES);
    expect(ctx(store).extractSummary).toEqual(EXTRACTION);
  });

  it("toggles topic selection by topic id", () => {
    const store = storeWithTopics();

    store.send({ type: "toggleTopic", topicId: 101 });
    expect(ctx(store).selectedTopicKeys.has(topicKey(101))).toBe(true);

    store.send({ type: "toggleTopic", topicId: 101 });
    expect(ctx(store).selectedTopicKeys.has(topicKey(101))).toBe(false);
  });

  it("toggles whole groups by group id", () => {
    const store = storeWithTopics();
    const detailGroupId = TOPIC_GROUPS[0]!.groupId;

    store.send({ type: "toggleGroup", groupId: detailGroupId, select: true });
    expect(ctx(store).selectedTopicKeys.has(topicKey(101))).toBe(true);
    expect(ctx(store).selectedTopicKeys.has(topicKey(102))).toBe(true);
    expect(ctx(store).selectedTopicKeys.has(topicKey(201))).toBe(false);

    store.send({ type: "toggleGroup", groupId: detailGroupId, select: false });
    expect(ctx(store).selectedTopicKeys.has(topicKey(101))).toBe(false);
    expect(ctx(store).selectedTopicKeys.has(topicKey(102))).toBe(false);
  });

  it("selects and deselects all topics", () => {
    const store = storeWithTopics();

    store.send({ type: "selectAllTopics" });
    expect(ctx(store).selectedTopicKeys.size).toBe(3);

    store.send({ type: "deselectAllTopics" });
    expect(ctx(store).selectedTopicKeys.size).toBe(0);
  });

  it("prunes invalid selected topics when a snapshot removes them", () => {
    const store = storeWithTopics();
    store.send({ type: "toggleTopic", topicId: 201 });
    expect(ctx(store).selectedTopicKeys.has(topicKey(201))).toBe(true);

    const reducedGroups = topicSummariesToTopicGroups(TOPIC_SUMMARIES.filter((topic) => topic.topicId !== 201));
    store.send({
      type: "topicSnapshotSynced",
      sessionId: 1,
      sessionCreatedAt: "2026-03-07T12:00:00.000Z",
      sessionStatus: "topics_extracted",
      sessionErrorMessage: null,
      groups: reducedGroups,
      outcomes: [{ family: "detail", status: "extracted", errorMessage: null }],
    });

    expect(ctx(store).selectedTopicKeys.has(topicKey(201))).toBe(false);
  });

  it("resumes a session with grouped topics and selections", () => {
    const store = createForgePageStore();
    const selectedSource = createPdfSelectedSource({
      sourceLabel: "source.pdf",
      sourceFilePath: "/tmp/source.pdf",
    });
    const selectedTopicKeys = new Set([topicKey(101), topicKey(201)]);

    store.send({
      type: "resumeSession",
      currentStep: "cards",
      selectedSource,
      extractState: { status: "idle" },
      sessionId: 42,
      targetDeckPath: "/workspace/decks/biology.md",
      topicGroups: TOPIC_GROUPS,
      extractionOutcomes: EXTRACTION_OUTCOMES,
      selectedTopicKeys,
    });

    expect(ctx(store).currentStep).toBe("cards");
    expect(ctx(store).selectedSource).toEqual(selectedSource);
    expect(ctx(store).activeExtractionSessionId).toBe(42);
    expect(ctx(store).topicGroups).toEqual(TOPIC_GROUPS);
    expect(ctx(store).selectedTopicKeys).toEqual(selectedTopicKeys);
  });

  it("keeps card curation scoped to selected topics", () => {
    const store = storeWithTopics();
    const alphaKey = topicKey(101);

    store.send({ type: "toggleTopic", topicId: 101 });
    store.send({ type: "setActiveCardsTopic", topicKey: alphaKey });
    store.send({ type: "markCardDeletedFromTopic", topicKey: alphaKey, cardId: 7 });
    store.send({
      type: "setCardExpandedPanelForTopic",
      topicKey: alphaKey,
      cardId: 7,
      panel: "cloze",
    });

    expect(ctx(store).activeTopicKey).toBe(alphaKey);
    expect(ctx(store).deletedCardIdsByTopicKey.get(alphaKey)?.has(7)).toBe(true);
    expect(ctx(store).expandedCardPanelsByTopicKey.get(alphaKey)?.get(7)).toBe("cloze");

    store.send({ type: "deselectAllTopics" });
    expect(ctx(store).activeTopicKey).toBeNull();
    expect(ctx(store).deletedCardIdsByTopicKey.size).toBe(0);
    expect(ctx(store).expandedCardPanelsByTopicKey.size).toBe(0);
  });

  it("maintains preview and extraction error state transitions", () => {
    const store = createForgePageStore();

    store.send({
      type: "setSelectedSource",
      selectedSource: createPdfSelectedSource({
        sourceLabel: "source.pdf",
        sourceFilePath: "/tmp/source.pdf",
      }),
    });
    expect(ctx(store).previewState).toEqual({ status: "loading" });

    store.send({ type: "previewError", message: "Preview failed" });
    expect(ctx(store).previewState).toEqual({ status: "error", message: "Preview failed" });

    store.send({ type: "setExtracting", startedAt: "2026-03-08T10:00:00.000Z" });
    store.send({ type: "extractionError", message: "Extraction failed" });
    expect(ctx(store).extractState).toEqual({ status: "error", message: "Extraction failed" });
    expect(ctx(store).currentStep).toBe("source");
  });
});

describe("topicSummariesToTopicGroups", () => {
  it("groups detail topics by chunk and synthesis topics into one section", () => {
    const groups = topicSummariesToTopicGroups(TOPIC_SUMMARIES);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      groupId: "chunk:10",
      groupKind: "chunk",
      family: "detail",
      title: "Chunk 1",
      displayOrder: 0,
      chunkId: 10,
      topics: [
        {
          topicId: 101,
          sessionId: 1,
          family: "detail",
          chunkId: 10,
          chunkSequenceOrder: 0,
          topicIndex: 0,
          topicText: "alpha",
          selected: false,
        },
        {
          topicId: 102,
          sessionId: 1,
          family: "detail",
          chunkId: 10,
          chunkSequenceOrder: 0,
          topicIndex: 1,
          topicText: "beta",
          selected: false,
        },
      ],
    });
    expect(groups[1]?.groupKind).toBe("section");
    expect(groups[1]?.family).toBe("synthesis");
    expect(groups[1]?.title).toBe("Synthesis");
  });
});

describe("forge-source helpers", () => {
  it("builds a PDF source input", () => {
    const selectedSource = createPdfSelectedSource({
      sourceLabel: "biology.pdf",
      sourceFilePath: "/tmp/biology.pdf",
    });

    expect(toForgeSourceInput(selectedSource)).toEqual({
      kind: "pdf",
      sourceFilePath: "/tmp/biology.pdf",
    });
  });

  it("builds a text source input", () => {
    const selectedSource = createTextSelectedSource({
      sourceLabel: "Pasted text",
      text: "alpha beta",
    });

    expect(toForgeSourceInput(selectedSource)).toEqual({
      kind: "text",
      sourceLabel: "Pasted text",
      text: "alpha beta",
    });
  });
});
