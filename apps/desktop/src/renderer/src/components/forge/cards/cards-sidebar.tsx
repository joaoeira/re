import type { TopicCardGeneration } from "./mock-cards-data";
import { SidebarTopicRow } from "./sidebar-topic-row";

type CardsTopic = {
  readonly topicKey: string;
  readonly text: string;
};

type CardsSidebarProps = {
  readonly topics: ReadonlyArray<CardsTopic>;
  readonly activeTopicKey: string | null;
  readonly generationByTopic: ReadonlyMap<string, TopicCardGeneration>;
  readonly addedCardIds: ReadonlySet<string>;
  readonly deletedCardIds: ReadonlySet<string>;
  readonly onSelectTopic: (topicKey: string) => void;
};

export function CardsSidebar({
  topics,
  activeTopicKey,
  generationByTopic,
  addedCardIds,
  deletedCardIds,
  onSelectTopic,
}: CardsSidebarProps) {
  let totalAdded = 0;
  let totalCards = 0;

  for (const gen of generationByTopic.values()) {
    for (const card of gen.cards) {
      if (deletedCardIds.has(card.id)) continue;
      totalCards++;
      if (addedCardIds.has(card.id)) totalAdded++;
    }
  }

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
        {topics.map((topic) => {
          const gen = generationByTopic.get(topic.topicKey);
          const visibleCards = gen?.cards.filter((c) => !deletedCardIds.has(c.id)) ?? [];
          const addedCount = visibleCards.filter((c) => addedCardIds.has(c.id)).length;

          return (
            <SidebarTopicRow
              key={topic.topicKey}
              topicKey={topic.topicKey}
              text={topic.text}
              active={topic.topicKey === activeTopicKey}
              status={gen?.status ?? "idle"}
              cardCount={visibleCards.length}
              addedCount={addedCount}
              onSelect={onSelectTopic}
            />
          );
        })}
      </div>
    </aside>
  );
}
