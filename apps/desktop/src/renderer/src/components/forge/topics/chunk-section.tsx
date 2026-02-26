import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";

import { topicKey } from "../forge-page-store";
import { TopicRow } from "./topic-row";

type ChunkSectionProps = {
  readonly chunkId: number;
  readonly sequenceOrder: number;
  readonly topics: ReadonlyArray<string>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggleTopic: (chunkId: number, topicIndex: number) => void;
  readonly onToggleAllChunk: (chunkId: number, select: boolean) => void;
};

export function ChunkSection({
  chunkId,
  sequenceOrder,
  topics,
  selectedKeys,
  onToggleTopic,
  onToggleAllChunk,
}: ChunkSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const selectedCount = topics.filter((_, i) => selectedKeys.has(topicKey(chunkId, i))).length;
  const allSelected = selectedCount === topics.length && topics.length > 0;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="mb-1">
      <div
        className="flex cursor-pointer items-center gap-2.5 py-3 select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <ChevronDownIcon
          className={`size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
        />
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected}
            onCheckedChange={() => onToggleAllChunk(chunkId, !allSelected)}
            aria-label={`Select all topics in chunk ${sequenceOrder}`}
          />
        </div>
        <span className="text-sm font-medium text-foreground/90">Chunk {sequenceOrder}</span>
        <div className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground/60">
          {selectedCount > 0 && (
            <>
              <span className="text-primary">{selectedCount}</span>
              <span className="text-muted-foreground/30">/</span>
            </>
          )}
          {topics.length}
        </span>
      </div>

      {!collapsed && (
        <div className="ml-6 border-t border-border/30 pt-2 flex flex-col gap-2">
          {topics.map((text, i) => (
            <TopicRow
              key={i}
              text={text}
              selected={selectedKeys.has(topicKey(chunkId, i))}
              onToggle={() => onToggleTopic(chunkId, i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
