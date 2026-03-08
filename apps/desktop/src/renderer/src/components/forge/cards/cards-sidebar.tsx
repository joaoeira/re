import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import type { ForgeTopicCardsStatus } from "@shared/rpc/schemas/forge";

import { SidebarTopicRow } from "./sidebar-topic-row";

type CardsTopic = {
  readonly topicKey: string;
  readonly family: "detail" | "synthesis";
  readonly text: string;
  readonly status: ForgeTopicCardsStatus;
  readonly cardCount: number;
  readonly addedCount: number;
};

type CardsSidebarProps = {
  readonly topics: ReadonlyArray<CardsTopic>;
  readonly activeTopicKey: string | null;
  readonly checkedTopicKeys: ReadonlySet<string>;
  readonly generatingChecked: boolean;
  readonly onSelectTopic: (topicKey: string) => void;
  readonly onCheckTopic: (topicKey: string) => void;
  readonly onClearChecked: () => void;
  readonly onGenerateChecked: () => void;
};

export function CardsSidebar({
  topics,
  activeTopicKey,
  checkedTopicKeys,
  generatingChecked,
  onSelectTopic,
  onCheckTopic,
  onClearChecked,
  onGenerateChecked,
}: CardsSidebarProps) {
  const selectionMode = checkedTopicKeys.size > 0;

  const { detailTopics, synthesisTopics } = useMemo(() => {
    const detail: CardsTopic[] = [];
    const synthesis: CardsTopic[] = [];
    for (const topic of topics) {
      if (topic.family === "synthesis") {
        synthesis.push(topic);
      } else {
        detail.push(topic);
      }
    }
    return { detailTopics: detail, synthesisTopics: synthesis };
  }, [topics]);

  const renderTopicRows = (sectionTopics: ReadonlyArray<CardsTopic>) =>
    sectionTopics.map((topic) => (
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
    ));

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-border">
      <div className="flex-1 overflow-y-auto">
        {detailTopics.length > 0 && (
          <>
            {synthesisTopics.length > 0 && (
              <div className="px-4 pb-1 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                  Details
                </span>
              </div>
            )}
            {renderTopicRows(detailTopics)}
          </>
        )}
        {synthesisTopics.length > 0 && (
          <>
            <div className="px-4 pb-1 pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                Synthesis
              </span>
            </div>
            {renderTopicRows(synthesisTopics)}
          </>
        )}
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
          <Button
            type="button"
            size="sm"
            className="mt-2.5 w-full"
            onClick={onGenerateChecked}
            disabled={generatingChecked}
          >
            {generatingChecked ? "Generating..." : "Generate cards"}
          </Button>
        </div>
      )}
    </aside>
  );
}
