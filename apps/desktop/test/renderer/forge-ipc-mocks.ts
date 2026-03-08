import type { ForgeSourceInput } from "@shared/rpc/schemas/forge";
import { vi } from "vitest";

import {
  DEFAULT_FORGE_DECKS,
  FORGE_WORKSPACE_ROOT_PATH,
  forgeSettingsSuccess,
  toDeckEntry,
} from "./forge-test-helpers";

export type ForgePreviewData = {
  readonly textLength: number;
  readonly totalPages: number;
  readonly chunkCount: number;
};

export type ForgeTopicsByChunk = {
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topics: ReadonlyArray<string>;
};

type ForgeTopicGroup = {
  readonly groupId: string;
  readonly groupKind: "chunk" | "section";
  readonly family: "detail" | "synthesis";
  readonly title: string;
  readonly displayOrder: number;
  readonly chunkId: number | null;
  readonly topics: ReadonlyArray<{
    readonly topicId: number;
    readonly sessionId: number;
    readonly family: "detail" | "synthesis";
    readonly chunkId: number | null;
    readonly chunkSequenceOrder: number | null;
    readonly topicIndex: number;
    readonly topicText: string;
    readonly selected: boolean;
  }>;
};

export const DEFAULT_FORGE_PREVIEW_DATA = {
  textLength: 230,
  totalPages: 4,
  chunkCount: 2,
} satisfies ForgePreviewData;

export const DEFAULT_FORGE_TOPICS_BY_CHUNK = [
  {
    chunkId: 101,
    sequenceOrder: 0,
    topics: ["biology", "cells"],
  },
  {
    chunkId: 102,
    sequenceOrder: 1,
    topics: ["membranes"],
  },
] satisfies ReadonlyArray<ForgeTopicsByChunk>;

export const DEFAULT_FORGE_CARDS_SNAPSHOT_TOPICS = [
  {
    topicId: 10,
    sessionId: 12,
    family: "detail",
    chunkId: 100,
    chunkSequenceOrder: 0,
    topicIndex: 0,
    topicText: "Cell biology",
    status: "generated",
    errorMessage: null,
    cardCount: 5,
    addedCount: 0,
    generationRevision: 1,
    selected: true,
  },
] as const;

const groupsFromTopicsByChunk = (
  sessionId: number,
  topicsByChunk: ReadonlyArray<ForgeTopicsByChunk>,
): ReadonlyArray<ForgeTopicGroup> =>
  topicsByChunk.map((chunk, index) => ({
    groupId: `chunk:${chunk.chunkId}`,
    groupKind: "chunk",
    family: "detail",
    title: `Chunk ${index + 1}`,
    displayOrder: chunk.sequenceOrder,
    chunkId: chunk.chunkId,
    topics: chunk.topics.map((topicText, topicIndex) => ({
      topicId: chunk.chunkId * 100 + topicIndex + 1,
      sessionId,
      family: "detail",
      chunkId: chunk.chunkId,
      chunkSequenceOrder: chunk.sequenceOrder,
      topicIndex,
      topicText,
      selected: false,
      })),
  }));

export const createForgeTopicExtractionSnapshotSuccess = (options?: {
  readonly source?: ForgeSourceInput | undefined;
  readonly sessionId?: number;
  readonly topicsByChunk?: ReadonlyArray<ForgeTopicsByChunk>;
  readonly status?: "topics_extracted" | "topics_extracting" | "error";
  readonly errorMessage?: string | null;
}) => {
  const {
    sessionId = 12,
    topicsByChunk = DEFAULT_FORGE_TOPICS_BY_CHUNK,
    status = "topics_extracted",
    errorMessage = null,
  } = options ?? {};
  const { sourceKind, sourceLabel, sourceFilePath } = resolveSourceDetails(options?.source);

  return success({
    session: {
      id: sessionId,
      sourceKind,
      sourceLabel,
      sourceFilePath,
      deckPath: null,
      sourceFingerprint: "fp:start",
      status,
      errorMessage,
      createdAt: "2025-01-10T00:00:00.000Z",
      updatedAt: "2025-01-10T00:00:00.000Z",
    },
    outcomes:
      status === "error"
        ? [{ family: "detail", status: "error", errorMessage }]
        : [{ family: "detail", status: "extracted", errorMessage: null }],
    groups: groupsFromTopicsByChunk(sessionId, topicsByChunk),
  });
};

const normalizeCardsSnapshotTopics = (
  sessionId: number,
  topics: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> =>
  topics.map((topic, index) => {
    const entry = topic as Record<string, unknown>;
    return {
      topicId: Number(entry.topicId ?? index + 1),
      sessionId: Number(entry.sessionId ?? sessionId),
      family: (entry.family as "detail" | "synthesis" | undefined) ?? "detail",
      chunkId: (entry.chunkId as number | null | undefined) ?? 100 + index,
      chunkSequenceOrder: (entry.chunkSequenceOrder as number | null | undefined) ?? index,
      topicIndex: Number(entry.topicIndex ?? 0),
      topicText: String(entry.topicText ?? `topic-${index + 1}`),
      status: (entry.status as string | undefined) ?? "generated",
      errorMessage: (entry.errorMessage as string | null | undefined) ?? null,
      cardCount: Number(entry.cardCount ?? 0),
      addedCount: Number(entry.addedCount ?? 0),
      generationRevision: Number(entry.generationRevision ?? 0),
      selected: Boolean(entry.selected ?? false),
    };
  });

type InvokeResult =
  | { readonly type: "success"; readonly data: unknown }
  | { readonly type: "failure"; readonly error: unknown };

type InvokeHandler = (payload: unknown, method: string) => InvokeResult | Promise<InvokeResult>;

type ForgeInvokeOptions = {
  readonly sessions?: ReadonlyArray<unknown>;
  readonly previewData?: ForgePreviewData;
  readonly topicsByChunk?: ReadonlyArray<ForgeTopicsByChunk>;
  readonly cardsSnapshotTopics?: ReadonlyArray<unknown>;
  readonly workspaceRootPath?: string;
  readonly handlers?: Partial<Record<string, InvokeResult | InvokeHandler>>;
};

const success = <T>(data: T): InvokeResult => ({
  type: "success",
  data,
});

const unknownMethod = (method: string): InvokeResult => ({
  type: "failure",
  error: { code: "UNKNOWN_METHOD", message: method },
});

const resolveOverride = async (
  override: InvokeResult | InvokeHandler,
  payload: unknown,
  method: string,
): Promise<InvokeResult> =>
  typeof override === "function" ? await override(payload, method) : override;

const resolveSourceDetails = (
  source: ForgeSourceInput | undefined,
): {
  readonly sourceKind: "pdf" | "text";
  readonly sourceLabel: string;
  readonly sourceFilePath: string | null;
} => {
  if (!source || source.kind === "pdf") {
    return {
      sourceKind: "pdf",
      sourceLabel: "source.pdf",
      sourceFilePath: source?.sourceFilePath ?? "/forge/source.pdf",
    };
  }

  return {
    sourceKind: "text",
    sourceLabel: source.sourceLabel ?? "Pasted text",
    sourceFilePath: null,
  };
};

export const createForgeStartTopicExtractionSuccess = (options?: {
  readonly source: ForgeSourceInput | undefined;
  readonly sessionId?: number;
  readonly topicsByChunk?: ReadonlyArray<ForgeTopicsByChunk>;
  readonly duplicateOfSessionId?: number | null;
  readonly sourceFingerprint?: string;
  readonly status?: "topics_extracted" | "topics_extracting" | "error";
  readonly errorMessage?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly textLength?: number;
  readonly preview?: string;
  readonly totalPages?: number;
  readonly chunkCount?: number;
}) => {
  const {
    sessionId = 12,
    topicsByChunk = DEFAULT_FORGE_TOPICS_BY_CHUNK,
    duplicateOfSessionId = null,
    sourceFingerprint = "fp:start",
    status = "topics_extracted",
    errorMessage = null,
    createdAt = "2025-01-10T00:00:00.000Z",
    updatedAt = "2025-01-10T00:00:00.000Z",
    textLength = DEFAULT_FORGE_PREVIEW_DATA.textLength,
    preview = "sample extracted preview",
    totalPages = DEFAULT_FORGE_PREVIEW_DATA.totalPages,
    chunkCount = DEFAULT_FORGE_PREVIEW_DATA.chunkCount,
  } = options ?? {};
  const { sourceKind, sourceLabel, sourceFilePath } = resolveSourceDetails(options?.source);

  return success({
    session: {
      id: sessionId,
      sourceKind,
      sourceLabel,
      sourceFilePath,
      deckPath: null,
      sourceFingerprint,
      status,
      errorMessage,
      createdAt,
      updatedAt,
    },
    duplicateOfSessionId,
    extraction: {
      sessionId,
      textLength,
      preview,
      totalPages,
      chunkCount,
    },
    outcomes: [
      {
        family: "detail",
        status: status === "error" ? "error" : "extracted",
        errorMessage,
      },
    ],
    groups: groupsFromTopicsByChunk(sessionId, topicsByChunk),
  });
};

export const createForgeInvoke = (options: ForgeInvokeOptions = {}) => {
  const workspaceRootPath = options.workspaceRootPath ?? FORGE_WORKSPACE_ROOT_PATH;
  let decks = DEFAULT_FORGE_DECKS.map((deck) => ({ ...deck }));

  return vi.fn().mockImplementation(async (method: string, payload?: unknown) => {
    const override = options.handlers?.[method];
    if (override) {
      return resolveOverride(override, payload, method);
    }

    switch (method) {
      case "GetSettings":
        return forgeSettingsSuccess(workspaceRootPath);
      case "ScanDecks":
        return success({
          rootPath: workspaceRootPath,
          decks,
        });
      case "CreateDeck": {
        const input = payload as { relativePath: string };
        const createdDeck = toDeckEntry(workspaceRootPath, input.relativePath);
        if (!decks.some((deck) => deck.absolutePath === createdDeck.absolutePath)) {
          decks = [...decks, createdDeck].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
          );
        }
        return success({
          absolutePath: createdDeck.absolutePath,
        });
      }
      case "ForgeListSessions":
        return success({ sessions: options.sessions ?? [] });
      case "ForgePreviewChunks":
        return success(options.previewData ?? DEFAULT_FORGE_PREVIEW_DATA);
      case "ForgeStartTopicExtraction":
        return createForgeStartTopicExtractionSuccess({
          source: (payload as { source?: ForgeSourceInput } | undefined)?.source,
          ...(options.topicsByChunk ? { topicsByChunk: options.topicsByChunk } : {}),
        });
      case "ForgeGetTopicExtractionSnapshot":
        return createForgeTopicExtractionSnapshotSuccess({
          sessionId: 12,
          topicsByChunk: options.topicsByChunk ?? DEFAULT_FORGE_TOPICS_BY_CHUNK,
        });
      case "ForgeGetCardsSnapshot":
        return success({
          topics: normalizeCardsSnapshotTopics(
            12,
            options.cardsSnapshotTopics ?? DEFAULT_FORGE_CARDS_SNAPSHOT_TOPICS,
          ),
        });
      case "ForgeSaveTopicSelections":
      case "ForgeSetSessionDeckPath":
        return success({});
      default:
        return unknownMethod(method);
    }
  });
};
