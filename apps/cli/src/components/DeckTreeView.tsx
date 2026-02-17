import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useCallback, useRef } from "react";
import type { DeckTreeNode } from "../lib/buildDeckTree";
import type { Selection } from "../services/ReviewQueue";
import { themeColors as theme, glyphs } from "../ThemeContext";

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
  type: "all" | "folder" | "deck";
  hasIssue: boolean;
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
  const parts: string[] = [];
  if (stats.newCards > 0) parts.push(`${stats.newCards} new`);
  if (stats.dueCards > 0) parts.push(`${stats.dueCards} due`);
  parts.push(`${stats.totalCards} total`);
  return parts.join(" · ");
}

function formatStatsCompact(stats: AggregatedStats): string {
  if (stats.totalCards === 0) return "empty";
  const parts: string[] = [];
  if (stats.newCards > 0) parts.push(`${stats.newCards}n`);
  if (stats.dueCards > 0) parts.push(`${stats.dueCards}d`);
  if (parts.length === 0) return `${stats.totalCards}`;
  return parts.join(" ");
}

function getTreePrefix(depth: number, isLast: boolean): string {
  if (depth === 0) return "";
  const indent = "  ".repeat(depth - 1);
  const connector = isLast ? glyphs.corner : glyphs.tee;
  return indent + connector + glyphs.horizontalBar + " ";
}

function flattenTree(nodes: readonly DeckTreeNode[], depth: number = 0): FlattenedItem[] {
  const items: FlattenedItem[] = [];

  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const prefix = getTreePrefix(depth, isLast);

    if (node.type === "folder") {
      const stats = aggregateStats(node.children);
      items.push({
        selection: { type: "folder", path: node.path },
        name: `${prefix}${glyphs.folder} ${node.name}`,
        description: formatStatsCompact(stats),
        depth,
        type: "folder",
        hasIssue: false,
      });
      items.push(...flattenTree(node.children, depth + 1));
    } else {
      const { stats } = node;
      const isEmpty = stats.isEmpty;
      const hasError = stats.parseError !== null;

      items.push({
        selection: { type: "deck", path: stats.path },
        name: `${prefix}${glyphs.file} ${stats.name}`,
        description: (() => {
          if (hasError) return "parse error";
          if (isEmpty) return "empty";
          return formatStatsCompact({
            totalCards: stats.totalCards,
            newCards: stats.newCards,
            dueCards: stats.dueCards,
          });
        })(),
        depth,
        type: "deck",
        hasIssue: hasError || isEmpty,
      });
    }
  });

  return items;
}

export function DeckTreeView({ tree, focused = false, onSelect, onChange }: DeckTreeViewProps) {
  const totals = aggregateStats(tree);
  const currentIndexRef = useRef(0);

  const options = useMemo(() => {
    const allItem: FlattenedItem = {
      selection: { type: "all" },
      name: `${glyphs.stack} All decks`,
      description: formatStats(totals),
      depth: 0,
      type: "all",
      hasIssue: false,
    };
    const treeItems = flattenTree(tree);
    const flatItems = [allItem, ...treeItems];

    return flatItems.map((item) => ({
      name: item.name,
      description: item.description,
      value: item.selection,
    }));
  }, [tree, totals]);

  // Height: show up to 15 items, each item takes 2 lines (name + description)
  const selectHeight = Math.min(options.length * 2, 30);

  const handleChange = useCallback(
    (index: number, option: SelectOption | null) => {
      currentIndexRef.current = index;
      if (option && onChange) {
        onChange(option.value as Selection);
      }
    },
    [onChange],
  );

  const handleSelect = useCallback(
    (index: number, option: SelectOption | null) => {
      if (option && onSelect) {
        onSelect(option.value as Selection);
      }
    },
    [onSelect],
  );

  // Handle space bar to select the current item
  useKeyboard((key) => {
    if (!focused) return;
    if (key.name === "space" && onSelect) {
      const currentOption = options[currentIndexRef.current];
      if (currentOption) onSelect(currentOption.value);
    }
  });

  return (
    <select
      options={options}
      focused={focused}
      onChange={handleChange}
      onSelect={handleSelect}
      wrapSelection={true}
      showDescription={true}
      showScrollIndicator={true}
      width={65}
      height={selectHeight}
      selectedBackgroundColor={theme.backgroundSelected}
      selectedTextColor={theme.text}
      descriptionColor={theme.textMuted}
      selectedDescriptionColor={theme.textMuted}
    />
  );
}
