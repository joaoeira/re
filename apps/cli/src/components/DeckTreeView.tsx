import type { SelectOption } from "@opentui/core";
import { useMemo, useCallback } from "react";
import type { DeckTreeNode } from "../lib/buildDeckTree";
import type { Selection } from "../services/ReviewQueue";

interface DeckTreeViewProps {
  tree: DeckTreeNode[];
  focused?: boolean;
  onSelect?: (selection: Selection) => void;
  onChange?: (selection: Selection) => void;
}

interface AggregatedStats {
  totalCards: number;
  newCards: number;
  dueCards: number;
}

interface FlattenedItem {
  selection: Selection;
  name: string;
  description: string;
  depth: number;
}

function aggregateStats(nodes: readonly DeckTreeNode[]): AggregatedStats {
  let totalCards = 0;
  let newCards = 0;
  let dueCards = 0;

  for (const node of nodes) {
    if (node.type === "deck") {
      totalCards += node.stats.totalCards;
      newCards += node.stats.newCards;
      dueCards += node.stats.dueCards;
    } else {
      const childStats = aggregateStats(node.children);
      totalCards += childStats.totalCards;
      newCards += childStats.newCards;
      dueCards += childStats.dueCards;
    }
  }

  return { totalCards, newCards, dueCards };
}

function formatStats(stats: AggregatedStats): string {
  return `${stats.totalCards} total | ${stats.newCards} new | ${stats.dueCards} due`;
}

function flattenTree(
  nodes: readonly DeckTreeNode[],
  depth: number = 0
): FlattenedItem[] {
  const items: FlattenedItem[] = [];

  for (const node of nodes) {
    if (node.type === "folder") {
      const stats = aggregateStats(node.children);
      items.push({
        selection: { type: "folder", path: node.path },
        name: "  ".repeat(depth) + "📁 " + node.name,
        description: formatStats(stats),
        depth,
      });
      items.push(...flattenTree(node.children, depth + 1));
    } else {
      const { stats } = node;
      const isEmpty = stats.isEmpty;
      const hasError = stats.parseError !== null;

      items.push({
        selection: { type: "deck", path: stats.path },
        name: (() => {
          const baseText = "  ".repeat(depth) + "📄 " + stats.name;
          const suffix = hasError ? " [error]" : isEmpty ? " [empty]" : "";
          return baseText + suffix;
        })(),
        description: (() => {
          if (hasError) return "Parse error";
          if (isEmpty) return "No cards";
          return formatStats({
            totalCards: stats.totalCards,
            newCards: stats.newCards,
            dueCards: stats.dueCards,
          });
        })(),
        depth,
      });
    }
  }

  return items;
}

export function DeckTreeView({
  tree,
  focused = false,
  onSelect,
  onChange,
}: DeckTreeViewProps) {
  const totals = aggregateStats(tree);

  const options = useMemo(() => {
    const allItem: FlattenedItem = {
      selection: { type: "all" },
      name: "📚 All",
      description: formatStats(totals),
      depth: 0,
    };
    const treeItems = flattenTree(tree);
    const flatItems = [allItem, ...treeItems];

    return flatItems.map((item) => ({
      name: item.name,
      description: item.description,
      value: item.selection,
    }));
  }, [tree, totals]);

  // Calculate height based on number of options (2 lines per item: name + description)
  const selectHeight = Math.min(options.length * 2, 20);

  const handleChange = useCallback(
    (index: number, option: SelectOption | null) => {
      if (option && onChange) {
        onChange(option.value as Selection);
      }
    },
    [onChange]
  );

  const handleSelect = useCallback(
    (index: number, option: SelectOption | null) => {
      if (option && onSelect) {
        onSelect(option.value as Selection);
      }
    },
    [onSelect]
  );

  return (
    <select
      options={options}
      focused={focused}
      onChange={handleChange}
      onSelect={handleSelect}
      wrapSelection={true}
      showDescription={true}
      showScrollIndicator={true}
      width={60}
      height={selectHeight}
      selectedBackgroundColor="#334455"
      selectedTextColor="#FFFFFF"
      descriptionColor="#888888"
      selectedDescriptionColor="#AAAAAA"
    />
  );
}
