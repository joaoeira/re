import { SidebarTopicRow } from "./sidebar-topic-row";
import type { ForgeTopicCardsStatus } from "@shared/rpc/schemas/forge";

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
  readonly onSelectTopic: (topicKey: string) => void;
};

export function CardsSidebar({
  topics,
  activeTopicKey,
  totalAdded,
  totalCards,
  onSelectTopic,
}: CardsSidebarProps) {
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
            status={topic.status}
            cardCount={topic.cardCount}
            addedCount={topic.addedCount}
            onSelect={onSelectTopic}
          />
        ))}
      </div>
    </aside>
  );
}
