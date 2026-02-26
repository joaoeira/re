import { useMemo } from "react";

import {
  useForgeExtractSummary,
  useForgeSelectedTopicCount,
  useForgeSelectedTopicKeys,
  useForgeTopicActions,
  useForgeTopicsByChunk,
} from "../forge-page-context";
import { ChunkSection } from "./chunk-section";

export function TopicSelection() {
  const topicsByChunk = useForgeTopicsByChunk();
  const selectedKeys = useForgeSelectedTopicKeys();
  const extractSummary = useForgeExtractSummary();
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
          <span className="font-mono text-foreground/70">{topicsByChunk.length}</span> chunks
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
        {topicsByChunk.map((chunk, i) => (
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
      </div>
    </div>
  );
}
