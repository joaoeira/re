import type { ForgeSourceInput } from "@shared/rpc/schemas/forge";

const normalizeForgeSourceText = (text: string): string => text.replace(/\r\n?/g, "\n").trim();

const hashForgeSourceText = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const forgeSourceCacheKey = (source: ForgeSourceInput | null): string | null => {
  if (!source) return null;

  switch (source.kind) {
    case "pdf":
      return `pdf:${source.sourceFilePath}`;
    case "text": {
      const normalizedText = normalizeForgeSourceText(source.text);
      return `text:${normalizedText.length}:${hashForgeSourceText(normalizedText)}`;
    }
  }
};

export const queryKeys = {
  settings: ["settings"] as const,
  gitSyncSnapshot: (rootPath: string | null) => ["gitSyncSnapshot", rootPath] as const,
  forgeSessionList: ["forgeSessionList"] as const,
  apiKeysConfigured: ["apiKeysConfigured"] as const,
  workspaceSnapshotPrefix: ["workspaceSnapshot"] as const,
  workspaceSnapshot: (rootPath: string | null) => ["workspaceSnapshot", rootPath] as const,
  scanDecks: (rootPath: string | null) => ["scanDecks", rootPath] as const,
  forgePreview: (source: ForgeSourceInput | null) =>
    ["forgePreview", forgeSourceCacheKey(source)] as const,
  forgeTopicSnapshot: (sessionId: number | null) => ["forgeTopicSnapshot", sessionId] as const,
  forgeCardsSnapshot: (sessionId: number | null) => ["forgeCardsSnapshot", sessionId] as const,
  forgeTopicCards: (sessionId: number | null, chunkId: number | null, topicIndex: number | null) =>
    ["forgeTopicCards", sessionId, chunkId, topicIndex] as const,
  forgeCardPermutations: (sourceCardId: number | null) =>
    ["forgeCardPermutations", sourceCardId] as const,
  forgeCardCloze: (sourceCardId: number | null) => ["forgeCardCloze", sourceCardId] as const,
  reviewBootstrap: (deckSelectionKey: string) => ["reviewBootstrap", deckSelectionKey] as const,
};
