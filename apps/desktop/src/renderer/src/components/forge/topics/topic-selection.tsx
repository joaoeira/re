import { useMemo } from "react";

import {
  useForgeExtractState,
  useForgeExtractSummary,
  useForgeSelectedTopicCount,
  useForgeSelectedTopicKeys,
  useForgeTopicSyncErrorMessage,
  useForgeTopicActions,
  useForgeTopicsByChunk,
} from "../forge-page-context";
import { ChunkSection } from "./chunk-section";

export function TopicSelection() {
  const topicsByChunk = useForgeTopicsByChunk();
  const chunksWithTopics = useMemo(
    () => topicsByChunk.filter((chunk) => chunk.topics.length > 0),
    [topicsByChunk],
  );
  const selectedKeys = useForgeSelectedTopicKeys();
  const extractSummary = useForgeExtractSummary();
  const extractState = useForgeExtractState();
  const topicSyncErrorMessage = useForgeTopicSyncErrorMessage();
  const actions = useForgeTopicActions();
  const selectedCount = useForgeSelectedTopicCount();

  const totalTopics = useMemo(
    () => topicsByChunk.reduce((sum, c) => sum + c.topics.length, 0),
    [topicsByChunk],
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium text-foreground">Select topics</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Choose which topics to generate flashcards for. Each topic typically produces 5-7 cards.
        </p>
      </div>

      {extractSummary && (
        <p className="text-xs text-muted-foreground">
          Extracted <span className="font-mono text-foreground/70">{totalTopics}</span> topics from{" "}
          <span className="font-mono text-foreground/70">{chunksWithTopics.length}</span> chunks
        </p>
      )}

      {extractState.status === "extracting" && (
        <p className="text-xs text-muted-foreground">
          Extracting topics now. Chunks appear here as they finish.
        </p>
      )}

      {extractState.status === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {extractState.message}
        </p>
      )}

      {topicSyncErrorMessage && extractState.status === "extracting" && (
        <p role="alert" className="text-xs text-destructive/90">
          Sync warning: {topicSyncErrorMessage}
        </p>
      )}

      <div className="flex items-center gap-1 border-b border-border/30 pb-3.5">
        <button
          type="button"
          onClick={actions.selectAllTopics}
          className="rounded px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Select all
        </button>
        <span className="text-muted-foreground/20">·</span>
        <button
          type="button"
          onClick={actions.deselectAllTopics}
          className="rounded px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Deselect all
        </button>
        <div className="flex-1" />
        {selectedCount > 0 && (
          <span className="font-mono text-xs text-primary">{selectedCount} selected</span>
        )}
      </div>

      <div>
        {chunksWithTopics.map((chunk, i) => (
          <div
            key={chunk.chunkId}
            className="animate-in fade-in-0 slide-in-from-bottom-1"
            style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
          >
            <ChunkSection
              chunkId={chunk.chunkId}
              sequenceOrder={chunk.sequenceOrder}
              topics={chunk.topics}
              selectedKeys={selectedKeys}
              onToggleTopic={actions.toggleTopic}
              onToggleAllChunk={actions.toggleAllChunk}
            />
          </div>
        ))}
        {chunksWithTopics.length === 0 && extractState.status === "extracting" ? (
          <p className="py-6 text-xs text-muted-foreground/80">Waiting for first chunk...</p>
        ) : null}
      </div>
    </div>
  );
}
