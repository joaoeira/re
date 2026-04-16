import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import type { ForgeTopicGroup } from "@shared/rpc/schemas/forge";

import { topicKey } from "../forge-page-store";
import { TopicRow } from "./topic-row";

type TopicGroupSectionProps = {
  readonly group: ForgeTopicGroup;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggleTopic: (topicId: number) => void;
  readonly onToggleGroup: (groupId: string, select: boolean) => void;
};

export function TopicGroupSection({
  group,
  selectedKeys,
  onToggleTopic,
  onToggleGroup,
}: TopicGroupSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const selectedCount = group.topics.filter((topic) =>
    selectedKeys.has(topicKey(topic.topicId)),
  ).length;
  const allSelected = selectedCount === group.topics.length && group.topics.length > 0;
  const someSelected = selectedCount > 0 && !allSelected;
  const selectionLabel = `Select all topics in ${group.title.toLowerCase()}`;

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
            onCheckedChange={() => onToggleGroup(group.groupId, !allSelected)}
            aria-label={selectionLabel}
          />
        </div>
        <span className="text-sm font-medium text-foreground/90">{group.title}</span>
        <div className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground/60">
          {selectedCount > 0 && (
            <>
              <span className="text-primary">{selectedCount}</span>
              <span className="text-muted-foreground/30">/</span>
            </>
          )}
          {group.topics.length}
        </span>
      </div>

      {!collapsed && (
        <div className="ml-6 border-t border-border/30 pt-2 flex flex-col gap-2">
          {group.topics.map((topic) => (
            <TopicRow
              key={topic.topicId}
              text={topic.topicText}
              selected={selectedKeys.has(topicKey(topic.topicId))}
              onToggle={() => onToggleTopic(topic.topicId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
