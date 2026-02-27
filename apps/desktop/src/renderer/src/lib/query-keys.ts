export const queryKeys = {
  settings: ["settings"] as const,
  apiKeysConfigured: ["apiKeysConfigured"] as const,
  workspaceSnapshotPrefix: ["workspaceSnapshot"] as const,
  workspaceSnapshot: (rootPath: string | null) => ["workspaceSnapshot", rootPath] as const,
  forgePreview: (sourceFilePath: string | null) => ["forgePreview", sourceFilePath] as const,
  forgeTopicSnapshot: (sourceFilePath: string | null) =>
    ["forgeTopicSnapshot", sourceFilePath] as const,
  reviewBootstrap: (deckSelectionKey: string) => ["reviewBootstrap", deckSelectionKey] as const,
};
