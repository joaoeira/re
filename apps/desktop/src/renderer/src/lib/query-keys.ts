export const queryKeys = {
  settings: ["settings"] as const,
  forgeSessionList: ["forgeSessionList"] as const,
  apiKeysConfigured: ["apiKeysConfigured"] as const,
  workspaceSnapshotPrefix: ["workspaceSnapshot"] as const,
  workspaceSnapshot: (rootPath: string | null) => ["workspaceSnapshot", rootPath] as const,
  scanDecks: (rootPath: string | null) => ["scanDecks", rootPath] as const,
  forgePreview: (sourceFilePath: string | null) => ["forgePreview", sourceFilePath] as const,
  forgeTopicSnapshot: (sourceFilePath: string | null) =>
    ["forgeTopicSnapshot", sourceFilePath] as const,
  forgeCardsSnapshot: (sessionId: number | null) => ["forgeCardsSnapshot", sessionId] as const,
  forgeTopicCards: (sessionId: number | null, chunkId: number | null, topicIndex: number | null) =>
    ["forgeTopicCards", sessionId, chunkId, topicIndex] as const,
  forgeCardPermutations: (sourceCardId: number | null) =>
    ["forgeCardPermutations", sourceCardId] as const,
  forgeCardCloze: (sourceCardId: number | null) => ["forgeCardCloze", sourceCardId] as const,
  reviewBootstrap: (deckSelectionKey: string) => ["reviewBootstrap", deckSelectionKey] as const,
};
