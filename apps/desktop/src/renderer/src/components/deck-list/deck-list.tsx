import { useMemo } from "react";
import { useSelector } from "@xstate/store-react";
import { buildDeckTree, flattenDeckTree, type DeckSnapshot } from "@re/workspace";
import { useDeckListStore } from "@shared/state/stores-context";
import { collectGroupDeckDescendants } from "@shared/lib/deckTreeSelectors";
import { DeckRow } from "./deck-row";

type DeckListProps = {
  readonly snapshots: readonly DeckSnapshot[];
};

export function DeckList({ snapshots }: DeckListProps) {
  const deckListStore = useDeckListStore();
  const collapsed = useSelector(deckListStore, (s) => s.context.collapsed);

  const tree = useMemo(() => buildDeckTree(snapshots), [snapshots]);
  const groupDescendants = useMemo(() => collectGroupDeckDescendants(tree), [tree]);
  const rows = useMemo(() => flattenDeckTree(tree, collapsed), [tree, collapsed]);

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
            descendantDeckPaths={groupDescendants.get(row.node.relativePath) ?? []}
          />
        ))}
      </div>
    </div>
  );
}
