import { Button } from "@/components/ui/button";
import type { ForgeTopicCardsStatus } from "@shared/rpc/schemas/forge";

import { SidebarTopicRow } from "./sidebar-topic-row";

type CardsTopic = {
  readonly topicKey: string;
  readonly text: string;
  readonly status: ForgeTopicCardsStatus;
  readonly cardCount: number;
  readonly addedCount: number;
};

type CardsSidebarProps = {
  readonly topics: ReadonlyArray<CardsTopic>;
  readonly activeTopicKey: string | null;
  readonly totalAdded: number;
  readonly totalCards: number;
  readonly checkedTopicKeys: ReadonlySet<string>;
  readonly onSelectTopic: (topicKey: string) => void;
  readonly onCheckTopic: (topicKey: string) => void;
  readonly onClearChecked: () => void;
  readonly onGenerateChecked: () => void;
};

export function CardsSidebar({
  topics,
  activeTopicKey,
  totalAdded,
  totalCards,
  checkedTopicKeys,
  onSelectTopic,
  onCheckTopic,
  onClearChecked,
  onGenerateChecked,
}: CardsSidebarProps) {
  const selectionMode = checkedTopicKeys.size > 0;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
          Topics · {topics.length}
        </span>
        <span className="text-[10px] text-muted-foreground/40">
          {totalAdded}/{totalCards} added
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {topics.map((topic) => (
          <SidebarTopicRow
            key={topic.topicKey}
            topicKey={topic.topicKey}
            text={topic.text}
            active={topic.topicKey === activeTopicKey}
            checked={checkedTopicKeys.has(topic.topicKey)}
            selectionMode={selectionMode}
            status={topic.status}
            cardCount={topic.cardCount}
            addedCount={topic.addedCount}
            onSelect={onSelectTopic}
            onCheck={onCheckTopic}
          />
        ))}
      </div>
      {selectionMode && (
        <div className="border-t border-primary/15 bg-primary/[0.03] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium text-primary">
              {checkedTopicKeys.size} selected
            </span>
            <button
              type="button"
              onClick={onClearChecked}
              className="text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
            >
              <kbd className="rounded border border-border bg-muted/30 px-1.5 py-px font-mono text-[10px]">
                Esc
              </kbd>
            </button>
          </div>
          <Button type="button" size="sm" className="mt-2.5 w-full" onClick={onGenerateChecked}>
            Generate cards
          </Button>
        </div>
      )}
    </aside>
  );
}
