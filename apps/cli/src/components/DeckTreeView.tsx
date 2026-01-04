import type { DeckTreeNode } from "../lib/buildDeckTree";
import type { DeckStats } from "../services/DeckLoader";

interface DeckTreeViewProps {
  tree: DeckTreeNode[];
  depth?: number;
}

interface AggregatedStats {
  totalCards: number;
  newCards: number;
  dueCards: number;
}

function aggregateStats(nodes: DeckTreeNode[]): AggregatedStats {
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
  return `[${stats.totalCards} | ${stats.newCards} new | ${stats.dueCards} due]`;
}

function DeckLine({ stats }: { stats: DeckStats }) {
  const isEmpty = stats.isEmpty;
  const hasError = stats.parseError !== null;

  // Format: "deck.md [10 | 3 new | 2 due]" or dimmed if empty
  const label = stats.parseError
    ? `${stats.name}.md [error]`
    : stats.isEmpty
    ? `${stats.name}.md [empty]`
    : `${stats.name}.md [${stats.totalCards} | ${stats.newCards} new | ${stats.dueCards} due]`;

  if (isEmpty || hasError) {
    return <text fg="#666666">{label}</text>;
  }

  return <text>{label}</text>;
}

function FolderNode({
  node,
  depth,
}: {
  node: DeckTreeNode & { type: "folder" };
  depth: number;
}) {
  const stats = aggregateStats(node.children);

  return (
    <box flexDirection="column" paddingLeft={depth * 2}>
      <text fg="#FFDD88" bg="#2A2A2A">
        {node.name} {formatStats(stats)}
      </text>
      {node.children.map((child, i) => (
        <TreeNode key={i} node={child} depth={depth + 1} />
      ))}
    </box>
  );
}

function TreeNode({ node, depth }: { node: DeckTreeNode; depth: number }) {
  if (node.type === "folder") {
    return <FolderNode node={node} depth={depth} />;
  }

  return (
    <box paddingLeft={depth * 2}>
      <DeckLine stats={node.stats} />
    </box>
  );
}

export function DeckTreeView({ tree, depth = 0 }: DeckTreeViewProps) {
  const totals = aggregateStats(tree);

  return (
    <box flexDirection="column">
      <text fg="#FFFFFF">All {formatStats(totals)}</text>
      {tree.map((node, i) => (
        <TreeNode key={i} node={node} depth={depth + 1} />
      ))}
    </box>
  );
}
