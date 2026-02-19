import type { SelectOption } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useMemo, useCallback, useRef } from "react";
import type { DeckTreeNode } from "@re/workspace";
import type { ReviewQueueSelection } from "../services";
import { themeColors as theme, glyphs } from "../ThemeContext";

interface DeckTreeViewProps {
  tree: DeckTreeNode[];
  focused?: boolean;
  onSelect?: (selection: ReviewQueueSelection) => void;
  onChange?: (selection: ReviewQueueSelection) => void;
}

interface AggregatedStats {
  totalCards: number;
  newCards: number;
  dueCards: number;
}

interface FlattenedItem {
  selection: ReviewQueueSelection;
  name: string;
  description: string;
  depth: number;
  type: "all" | "folder" | "deck";
  hasIssue: boolean;
}

function aggregateStats(nodes: readonly DeckTreeNode[]): AggregatedStats {
  return nodes.reduce(
    (acc, node) => {
      const stats = statsForNode(node);
      return {
        totalCards: acc.totalCards + stats.totalCards,
        newCards: acc.newCards + stats.newCards,
        dueCards: acc.dueCards + stats.dueCards,
      };
    },
    { totalCards: 0, newCards: 0, dueCards: 0 },
  );
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

function statsForNode(node: DeckTreeNode): AggregatedStats {
  if (node.kind === "group") {
    return {
      totalCards: node.totalCards,
      newCards: node.stateCounts.new,
      dueCards: node.dueCards,
    };
  }

  if (node.snapshot.status !== "ok") {
    return { totalCards: 0, newCards: 0, dueCards: 0 };
  }

  return {
    totalCards: node.snapshot.totalCards,
    newCards: node.snapshot.stateCounts.new,
    dueCards: node.snapshot.dueCards,
  };
}

function flattenTree(nodes: readonly DeckTreeNode[], depth: number = 0): FlattenedItem[] {
  const items: FlattenedItem[] = [];

  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1;
    const prefix = getTreePrefix(depth, isLast);

    if (node.kind === "group") {
      const stats = statsForNode(node);
      items.push({
        selection: { type: "folder", path: node.relativePath },
        name: `${prefix}${glyphs.folder} ${node.name}`,
        description: formatStatsCompact(stats),
        depth,
        type: "folder",
        hasIssue: node.errorCount > 0,
      });
      items.push(...flattenTree(node.children, depth + 1));
    } else {
      const hasError = node.snapshot.status !== "ok";
      const stats = statsForNode(node);
      const isEmpty = !hasError && stats.totalCards === 0;
      const errorDescription =
        node.snapshot.status === "read_error"
          ? "read error"
          : node.snapshot.status === "parse_error"
            ? "parse error"
            : "";

      items.push({
        selection: { type: "deck", path: node.relativePath },
        name: `${prefix}${glyphs.file} ${node.name}`,
        description: (() => {
          if (hasError) return errorDescription;
          if (isEmpty) return "empty";
          return formatStatsCompact(stats);
        })(),
        depth,
        type: "deck",
        hasIssue: hasError,
      });
    }
  });

  return items;
}

export function DeckTreeView({ tree, focused = false, onSelect, onChange }: DeckTreeViewProps) {
  const totals = useMemo(() => aggregateStats(tree), [tree]);
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
        onChange(option.value as ReviewQueueSelection);
      }
    },
    [onChange],
  );

  const handleSelect = useCallback(
    (index: number, option: SelectOption | null) => {
      if (option && onSelect) {
        onSelect(option.value as ReviewQueueSelection);
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
