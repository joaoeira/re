import { useMemo } from "react";
import { useSelector } from "@xstate/store-react";
import { buildDeckTree, flattenDeckTree, type DeckSnapshot } from "@re/workspace";
import { deckListStore } from "@shared/state/deckListStore";
import { DeckRow } from "./deck-row";

type DeckListProps = {
  readonly snapshots: readonly DeckSnapshot[];
  readonly onDeckClick: (relativePath: string) => void;
};

export function DeckList({ snapshots, onDeckClick }: DeckListProps) {
  const collapsed = useSelector(deckListStore, (s) => s.context.collapsed);

  const tree = useMemo(() => buildDeckTree(snapshots), [snapshots]);
  const rows = useMemo(() => flattenDeckTree(tree, collapsed), [tree, collapsed]);

  const handleToggle = (path: string) => {
    deckListStore.send({ type: "toggle", path });
  };

  if (snapshots.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No decks found in this workspace.
      </div>
    );
  }

  return (
    <div>
      <div role="list">
        {rows.map((row) => (
          <DeckRow
            key={row.key}
            node={row.node}
            depth={row.depth}
            isCollapsed={row.node.kind === "group" && row.node.relativePath in collapsed}
            onToggle={handleToggle}
            onClick={onDeckClick}
          />
        ))}
      </div>
    </div>
  );
}
