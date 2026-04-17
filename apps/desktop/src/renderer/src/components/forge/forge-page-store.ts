import { createStore } from "@xstate/store";
import {
  sameDerivationParentRef,
  type DerivationParentRef,
  type ForgeSessionStatus,
  type ForgeTopicExtractionOutcome,
  type ForgeTopicGroup,
} from "@shared/rpc/schemas/forge";

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

export type ForgeStep = "source" | "topics" | "cards";
export type ForgeSourceEntryMode = "picker" | "text-editor";

export const topicKey = (topicId: number): string => `${topicId}`;

export type TopicCardIdMap = ReadonlyMap<string, ReadonlySet<number>>;
export type ForgeCardExpandedPanel = "permutations" | "cloze";
export type TopicExpandedCardPanelMap = ReadonlyMap<
  string,
  ReadonlyMap<number, ForgeCardExpandedPanel>
>;
export type ExpansionColumnDescriptor = {
  readonly id: string;
  readonly parent: DerivationParentRef;
  readonly rootCardId: number;
  readonly parentQuestion: string;
  readonly parentAnswer: string;
  readonly instruction?: string;
};
export type TopicExpansionColumnsMap = ReadonlyMap<
  string,
  ReadonlyArray<ExpansionColumnDescriptor>
>;

type ForgePageContext = {
  readonly currentStep: ForgeStep;
  readonly sourceEntryMode: ForgeSourceEntryMode;
  readonly selectedSource: ForgeSelectedSource | null;
  readonly textDraft: string;
  readonly textTitleDraft: string;
  readonly targetDeckPath: string | null;
  readonly duplicateOfSessionId: number | null;
  readonly sourceSelectionErrorMessage: string | null;
  readonly extractState: ExtractState;
  readonly activeExtractionStartedAt: string | null;
  readonly activeExtractionSessionId: number | null;
  readonly topicSyncErrorMessage: string | null;
  readonly extractSummary: ExtractSummary | null;
  readonly topicGroups: ReadonlyArray<ForgeTopicGroup>;
  readonly extractionOutcomes: ReadonlyArray<ForgeTopicExtractionOutcome>;
  readonly selectedTopicKeys: ReadonlySet<string>;
  readonly activeTopicKey: string | null;
  readonly deletedCardIdsByTopicKey: TopicCardIdMap;
  readonly expandedCardPanelsByTopicKey: TopicExpandedCardPanelMap;
  readonly expansionColumnsByTopicKey: TopicExpansionColumnsMap;
  readonly resumeErrorMessage: string | null;
};

const emptyTopicKeys: ReadonlySet<string> = new Set<string>();
const emptyTopicCardIdMap: TopicCardIdMap = new Map<string, ReadonlySet<number>>();
const emptyTopicExpandedCardPanelMap: TopicExpandedCardPanelMap = new Map<
  string,
  ReadonlyMap<number, ForgeCardExpandedPanel>
>();
const emptyTopicExpansionColumnsMap: TopicExpansionColumnsMap = new Map<
  string,
  ReadonlyArray<ExpansionColumnDescriptor>
>();

const initialForgePageContext = (): ForgePageContext => ({
  currentStep: "source",
  sourceEntryMode: "picker",
  selectedSource: null,
  textDraft: "",
  textTitleDraft: "",
  targetDeckPath: null,
  duplicateOfSessionId: null,
  sourceSelectionErrorMessage: null,
  extractState: { status: "idle" },
  activeExtractionStartedAt: null,
  activeExtractionSessionId: null,
  topicSyncErrorMessage: null,
  extractSummary: null,
  topicGroups: [],
  extractionOutcomes: [],
  selectedTopicKeys: emptyTopicKeys,
  activeTopicKey: null,
  deletedCardIdsByTopicKey: emptyTopicCardIdMap,
  expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
  expansionColumnsByTopicKey: emptyTopicExpansionColumnsMap,
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

const sortGroups = (groups: ReadonlyArray<ForgeTopicGroup>): ReadonlyArray<ForgeTopicGroup> =>
  groups
    .slice()
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder || left.groupId.localeCompare(right.groupId),
    );

const topicKeysFromGroups = (groups: ReadonlyArray<ForgeTopicGroup>): ReadonlySet<string> => {
  const valid = new Set<string>();
  for (const group of groups) {
    for (const topic of group.topics) {
      valid.add(topicKey(topic.topicId));
    }
  }
  return valid;
};

const pruneSelectedTopicKeys = (
  selectedTopicKeys: ReadonlySet<string>,
  topicGroups: ReadonlyArray<ForgeTopicGroup>,
): ReadonlySet<string> => {
  if (selectedTopicKeys.size === 0) return selectedTopicKeys;

  const valid = topicKeysFromGroups(topicGroups);
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

const pruneExpansionColumnsMap = (
  source: TopicExpansionColumnsMap,
  selectedTopicKeys: ReadonlySet<string>,
): TopicExpansionColumnsMap =>
  pruneMapByKeys(source, selectedTopicKeys, (columns) => columns.slice());

const firstSelectedTopicKeyInDisplayOrder = (
  topicGroups: ReadonlyArray<ForgeTopicGroup>,
  selectedTopicKeys: ReadonlySet<string>,
): string | null => {
  for (const group of topicGroups) {
    for (const topic of group.topics) {
      const key = topicKey(topic.topicId);
      if (selectedTopicKeys.has(key)) return key;
    }
  }
  return null;
};

const withPrunedSelections = (
  context: ForgePageContext,
  selectedTopicKeys: ReadonlySet<string>,
): Pick<
  ForgePageContext,
  | "selectedTopicKeys"
  | "activeTopicKey"
  | "deletedCardIdsByTopicKey"
  | "expandedCardPanelsByTopicKey"
  | "expansionColumnsByTopicKey"
> => ({
  selectedTopicKeys,
  activeTopicKey:
    context.activeTopicKey && selectedTopicKeys.has(context.activeTopicKey)
      ? context.activeTopicKey
      : firstSelectedTopicKeyInDisplayOrder(context.topicGroups, selectedTopicKeys),
  deletedCardIdsByTopicKey: pruneTopicCardIdMap(
    context.deletedCardIdsByTopicKey,
    selectedTopicKeys,
  ),
  expandedCardPanelsByTopicKey: pruneExpandedCardPanelMap(
    context.expandedCardPanelsByTopicKey,
    selectedTopicKeys,
  ),
  expansionColumnsByTopicKey: pruneExpansionColumnsMap(
    context.expansionColumnsByTopicKey,
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

const withOpenedExpansionColumn = (
  source: TopicExpansionColumnsMap,
  input: {
    readonly topicKey: string;
    readonly descriptor: ExpansionColumnDescriptor;
    readonly sourceColumnParent: DerivationParentRef | null;
  },
): TopicExpansionColumnsMap => {
  const existing = source.get(input.topicKey) ?? [];
  const sourceColumnParent = input.sourceColumnParent;
  if (sourceColumnParent !== null) {
    const sourceIndex = existing.findIndex((column) =>
      sameDerivationParentRef(column.parent, sourceColumnParent),
    );
    if (sourceIndex < 0) {
      return source;
    }
  }
  const retainedColumns =
    sourceColumnParent === null
      ? []
      : existing.slice(
          0,
          existing.findIndex((column) =>
            sameDerivationParentRef(column.parent, sourceColumnParent),
          ) + 1,
        );
  const nextMap = new Map(source);
  nextMap.set(input.topicKey, [...retainedColumns, input.descriptor]);
  return nextMap;
};

const withoutExpansionColumnsForTopic = (
  source: TopicExpansionColumnsMap,
  topicKeyValue: string,
): TopicExpansionColumnsMap => {
  if (!source.has(topicKeyValue)) return source;
  const nextMap = new Map(source);
  nextMap.delete(topicKeyValue);
  return nextMap;
};

const withExpansionColumnsTruncatedAt = (
  source: TopicExpansionColumnsMap,
  input: {
    readonly topicKey: string;
    readonly columnId: string;
  },
): TopicExpansionColumnsMap => {
  const existing = source.get(input.topicKey) ?? [];
  const index = existing.findIndex((column) => column.id === input.columnId);
  if (index < 0) return source;
  const nextMap = new Map(source);
  nextMap.set(input.topicKey, existing.slice(0, index + 1));
  return nextMap;
};

const withoutExpansionColumnAndRight = (
  source: TopicExpansionColumnsMap,
  input: {
    readonly topicKey: string;
    readonly columnId: string;
  },
): TopicExpansionColumnsMap => {
  const existing = source.get(input.topicKey) ?? [];
  const index = existing.findIndex((column) => column.id === input.columnId);
  if (index < 0) return source;
  const nextMap = new Map(source);
  const nextColumns = existing.slice(0, index);
  if (nextColumns.length === 0) {
    nextMap.delete(input.topicKey);
  } else {
    nextMap.set(input.topicKey, nextColumns);
  }
  return nextMap;
};

export const createForgePageStore = () =>
  createStore({
    context: initialForgePageContext(),
    on: {
      resetForNoSource: () => initialForgePageContext(),
      setSourceSelectionError: (_context, event: { message: string }) => ({
        ...initialForgePageContext(),
        sourceSelectionErrorMessage: event.message,
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
        sourceSelectionErrorMessage: null,
        extractState: { status: "idle" as const },
        activeExtractionStartedAt: null,
        activeExtractionSessionId: null,
        topicSyncErrorMessage: null,
        extractSummary: null,
        topicGroups: [],
        extractionOutcomes: [],
        selectedTopicKeys: emptyTopicKeys,
        activeTopicKey: null,
        deletedCardIdsByTopicKey: emptyTopicCardIdMap,
        expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
        expansionColumnsByTopicKey: emptyTopicExpansionColumnsMap,
        resumeErrorMessage: null,
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
        topicGroups: [],
        extractionOutcomes: [],
        selectedTopicKeys: emptyTopicKeys,
        activeTopicKey: null,
        deletedCardIdsByTopicKey: emptyTopicCardIdMap,
        expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
        expansionColumnsByTopicKey: emptyTopicExpansionColumnsMap,
      }),
      extractionSessionCreated: (context, event: { sessionId: number }) => {
        if (context.extractState.status !== "extracting") return context;
        if (context.activeExtractionSessionId !== null) return context;
        return {
          ...context,
          activeExtractionSessionId: event.sessionId,
        };
      },
      topicSnapshotSynced: (
        context,
        event: {
          sessionId: number;
          sessionCreatedAt: string;
          sessionStatus: ForgeSessionStatus;
          sessionErrorMessage: string | null;
          groups: ReadonlyArray<ForgeTopicGroup>;
          outcomes: ReadonlyArray<ForgeTopicExtractionOutcome>;
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

        if (
          context.extractSummary !== null &&
          context.extractState.status !== "extracting" &&
          event.sessionStatus === "topics_extracting"
        ) {
          return context;
        }

        const nextTopicGroups = sortGroups(event.groups);
        const nextSelectedTopicKeys = pruneSelectedTopicKeys(
          context.selectedTopicKeys,
          nextTopicGroups,
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
          topicGroups: nextTopicGroups,
          extractionOutcomes: event.outcomes,
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
          groups: ReadonlyArray<ForgeTopicGroup>;
          outcomes: ReadonlyArray<ForgeTopicExtractionOutcome>;
        },
      ) => {
        const nextTopicGroups = sortGroups(event.groups);
        const nextSelectedTopicKeys = pruneSelectedTopicKeys(
          context.selectedTopicKeys,
          nextTopicGroups,
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
          topicGroups: nextTopicGroups,
          extractionOutcomes: event.outcomes,
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
        topicGroups: [],
        extractionOutcomes: [],
        activeTopicKey: null,
        deletedCardIdsByTopicKey: emptyTopicCardIdMap,
        expandedCardPanelsByTopicKey: emptyTopicExpandedCardPanelMap,
        expansionColumnsByTopicKey: emptyTopicExpansionColumnsMap,
      }),
      toggleTopic: (context, event: { topicId: number }) => {
        const key = topicKey(event.topicId);
        const next = new Set(context.selectedTopicKeys);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return {
          ...context,
          ...withPrunedSelections(context, next),
        };
      },
      toggleGroup: (context, event: { groupId: string; select: boolean }) => {
        const group = context.topicGroups.find((g) => g.groupId === event.groupId);
        if (!group) return context;
        const next = new Set(context.selectedTopicKeys);
        group.topics.forEach((topic) => {
          const key = topicKey(topic.topicId);
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
        context.topicGroups.forEach((group) => {
          group.topics.forEach((topic) => next.add(topicKey(topic.topicId)));
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
        expansionColumnsByTopicKey: emptyTopicExpansionColumnsMap,
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
          expansionColumnsByTopicKey: withoutExpansionColumnsForTopic(
            context.expansionColumnsByTopicKey,
            event.topicKey,
          ),
        };
      },
      openExpansionColumnForTopic: (
        context,
        event: {
          topicKey: string;
          descriptor: ExpansionColumnDescriptor;
          sourceColumnParent: DerivationParentRef | null;
        },
      ) => ({
        ...context,
        expansionColumnsByTopicKey: withOpenedExpansionColumn(context.expansionColumnsByTopicKey, {
          topicKey: event.topicKey,
          descriptor: event.descriptor,
          sourceColumnParent: event.sourceColumnParent,
        }),
      }),
      closeExpansionColumnForTopic: (
        context,
        event: {
          topicKey: string;
          columnId: string;
        },
      ) => ({
        ...context,
        expansionColumnsByTopicKey: withoutExpansionColumnAndRight(
          context.expansionColumnsByTopicKey,
          {
            topicKey: event.topicKey,
            columnId: event.columnId,
          },
        ),
      }),
      truncateExpansionColumnsForTopic: (
        context,
        event: {
          topicKey: string;
          columnId: string;
        },
      ) => ({
        ...context,
        expansionColumnsByTopicKey: withExpansionColumnsTruncatedAt(
          context.expansionColumnsByTopicKey,
          {
            topicKey: event.topicKey,
            columnId: event.columnId,
          },
        ),
      }),
      clearExpansionColumnsForTopic: (
        context,
        event: {
          topicKey: string;
        },
      ) => ({
        ...context,
        expansionColumnsByTopicKey: withoutExpansionColumnsForTopic(
          context.expansionColumnsByTopicKey,
          event.topicKey,
        ),
      }),
      advanceToCards: (context) => ({
        ...context,
        currentStep: "cards" as const,
        activeTopicKey:
          context.activeTopicKey ??
          firstSelectedTopicKeyInDisplayOrder(context.topicGroups, context.selectedTopicKeys),
      }),
      setTargetDeckPath: (context, event: { deckPath: string | null }) => {
        if (context.targetDeckPath === event.deckPath) return context;
        return {
          ...context,
          targetDeckPath: event.deckPath,
        };
      },
      resumeSession: (
        _context,
        event: {
          currentStep: ForgeStep;
          selectedSource: ForgeSelectedSource | null;
          extractState: ExtractState;
          sessionId: number;
          targetDeckPath: string | null;
          topicGroups: ReadonlyArray<ForgeTopicGroup>;
          extractionOutcomes: ReadonlyArray<ForgeTopicExtractionOutcome>;
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
        topicGroups: event.topicGroups,
        extractionOutcomes: event.extractionOutcomes,
        selectedTopicKeys: event.selectedTopicKeys,
        activeTopicKey: firstSelectedTopicKeyInDisplayOrder(
          event.topicGroups,
          event.selectedTopicKeys,
        ),
        expansionColumnsByTopicKey: emptyTopicExpansionColumnsMap,
      }),
      resumeError: (context, event: { message: string }) => ({
        ...context,
        resumeErrorMessage: event.message,
      }),
    },
  });

export type ForgePageStore = ReturnType<typeof createForgePageStore>;
