import { useMemo } from "react";

import {
  useForgeExtractState,
  useForgeExtractSummary,
  useForgePreviewState,
  useForgeSelectedTopicCount,
  useForgeSelectedTopicKeys,
  useForgeTopicSyncErrorMessage,
  useForgeTopicActions,
  useForgeTopicGroups,
} from "../forge-page-context";
import { TopicGroupSection } from "./topic-group-section";

export function TopicSelection() {
  const topicGroups = useForgeTopicGroups();
  const populatedGroups = useMemo(
    () => topicGroups.filter((group) => group.topics.length > 0),
    [topicGroups],
  );
  const selectedKeys = useForgeSelectedTopicKeys();
  const extractSummary = useForgeExtractSummary();
  const extractState = useForgeExtractState();
  const previewState = useForgePreviewState();
  const topicSyncErrorMessage = useForgeTopicSyncErrorMessage();
  const actions = useForgeTopicActions();
  const selectedCount = useForgeSelectedTopicCount();

  const counts = useMemo(() => {
    let total = 0;
    let detailGroups = 0;

    for (const group of topicGroups) {
      total += group.topics.length;
      detailGroups += 1;
    }

    return { total, detailGroups };
  }, [topicGroups]);

  const chunkCount =
    extractSummary?.chunkCount ??
    (previewState.status === "ready" ? previewState.summary.chunkCount : null);
  const extractedChunks = counts.detailGroups;
  const extractPct =
    chunkCount && chunkCount > 0 ? Math.min((extractedChunks / chunkCount) * 100, 100) : null;
  const shouldShowSummary = counts.total > 0 || populatedGroups.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-lg font-medium text-foreground">Select topics</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Choose which topics to generate flashcards for. Each topic typically produces 5-7 cards.
        </p>
      </div>

      {shouldShowSummary && (
        <p className="text-xs text-muted-foreground">
          Extracted <span className="font-mono text-foreground/70">{counts.total}</span> topics
          from <span className="font-mono text-foreground/70">{counts.detailGroups}</span> chunk
          {counts.detailGroups === 1 ? "" : "s"}
        </p>
      )}

      {extractState.status === "extracting" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
            <span className="text-xs text-muted-foreground">
              {chunkCount && chunkCount > 0
                ? `Extracting section ${Math.min(extractedChunks + 1, chunkCount)} of ${chunkCount}…`
                : "Extracting sections…"}
            </span>
          </div>
          {extractPct !== null ? (
            <div
              role="progressbar"
              aria-label="Topic extraction progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(extractPct)}
              className="h-0.5 overflow-hidden rounded-full bg-border/50"
            >
              <div
                className="h-full rounded-full bg-muted-foreground/30 transition-[width] duration-500 ease-out"
                style={{ width: `${extractPct}%` }}
              />
            </div>
          ) : null}
        </div>
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
        {populatedGroups.map((group) => (
          <div key={group.groupId} className="animate-in fade-in-0 slide-in-from-bottom-1">
            <TopicGroupSection
              group={group}
              selectedKeys={selectedKeys}
              onToggleTopic={actions.toggleTopic}
              onToggleGroup={actions.toggleGroup}
            />
          </div>
        ))}
        {extractState.status === "extracting" && populatedGroups.length > 0 && (
          <div className="flex items-center gap-2.5 py-4 text-xs text-muted-foreground/60">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-muted-foreground/25 border-t-transparent" />
            Processing next section…
          </div>
        )}
        {populatedGroups.length === 0 && extractState.status === "extracting" ? (
          <p className="py-6 text-xs text-muted-foreground/80">Waiting for first chunk...</p>
        ) : null}
      </div>
    </div>
  );
}
