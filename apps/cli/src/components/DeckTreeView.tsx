import type { DeckTreeNode } from "../lib/buildDeckTree";
import type { DeckStats } from "../services/DeckLoader";

interface DeckTreeViewProps {
  tree: DeckTreeNode[];
  depth?: number;
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
  return (
    <box flexDirection="column" paddingLeft={depth * 2}>
      <text fg="#88AAFF">{node.name}/</text>
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
  return (
    <box flexDirection="column">
      {tree.map((node, i) => (
        <TreeNode key={i} node={node} depth={depth} />
      ))}
    </box>
  );
}
