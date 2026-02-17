import { useMemo } from "react";
import { useSelector } from "@xstate/store-react";
import {
  buildDeckTree,
  flattenDeckTree,
  type DeckSnapshot,
  type DeckTreeNode,
} from "@re/workspace";
import { deckListStore } from "@shared/state/deckListStore";
import { DeckRow } from "./deck-row";

type DeckListProps = {
  readonly snapshots: readonly DeckSnapshot[];
  readonly onDeckClick: (relativePath: string) => void;
};

const collectGroupPaths = (nodes: readonly DeckTreeNode[]): string[] => {
  const paths: string[] = [];
  const walk = (list: readonly DeckTreeNode[]) => {
    for (const node of list) {
      if (node.kind === "group") {
        paths.push(node.relativePath);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return paths;
};

export function DeckList({ snapshots, onDeckClick }: DeckListProps) {
  const collapsed = useSelector(deckListStore, (s) => s.context.collapsed);

  const tree = useMemo(() => buildDeckTree(snapshots), [snapshots]);
  const rows = useMemo(() => flattenDeckTree(tree, collapsed), [tree, collapsed]);

  const handleToggle = (path: string) => {
    deckListStore.send({ type: "toggle", path });
  };

  const handleExpandAll = () => {
    deckListStore.send({ type: "expandAll" });
  };

  const handleCollapseAll = () => {
    deckListStore.send({ type: "collapseAll", paths: collectGroupPaths(tree) });
  };

  if (snapshots.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No decks found in this workspace.
      </div>
    );
  }

  const hasGroups = tree.some((n) => n.kind === "group");

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground">Decks</h2>
        {hasGroups && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleExpandAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={handleCollapseAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      <div role="list">
        {rows.map((row) => (
          <DeckRow
            key={row.key}
            node={row.node}
            depth={row.depth}
            isCollapsed={
              row.node.kind === "group" &&
              row.node.relativePath in collapsed
            }
            onToggle={handleToggle}
            onClick={onDeckClick}
          />
        ))}
      </div>
    </div>
  );
}
