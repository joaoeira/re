import { useMemo } from "react";
import { useSelector } from "@xstate/store-react";
import { buildDeckTree, flattenDeckTree, type DeckSnapshot } from "@re/workspace";
import { deckListStore } from "@shared/state/deckListStore";
import { DeckRow } from "./deck-row";

export type CheckedState = boolean | "indeterminate";

type DeckListProps = {
  readonly snapshots: readonly DeckSnapshot[];
  readonly selectedDecks: Record<string, true>;
  readonly onToggleDeckSelection: (relativePath: string) => void;
  readonly onToggleFolderSelection: (
    relativePath: string,
    descendantDeckPaths: readonly string[],
  ) => void;
  readonly onDeckTitleClick: (relativePath: string) => void;
  readonly onFolderTitleClick: (relativePath: string, descendantDeckPaths: readonly string[]) => void;
};

const collectGroupDeckDescendants = (snapshotsTree: ReturnType<typeof buildDeckTree>) => {
  const descendantsByGroup = new Map<string, readonly string[]>();

  const collectNodeDescendants = (node: (typeof snapshotsTree)[number]): readonly string[] => {
    if (node.kind === "leaf") {
      return [node.relativePath];
    }

    const descendants: string[] = [];
    for (const child of node.children) {
      descendants.push(...collectNodeDescendants(child));
    }
    descendantsByGroup.set(node.relativePath, descendants);
    return descendants;
  };

  for (const node of snapshotsTree) {
    collectNodeDescendants(node);
  }

  return descendantsByGroup;
};

export const getGroupCheckboxState = (
  descendantDeckPaths: readonly string[],
  selectedDecks: Record<string, true>,
): CheckedState => {
  if (descendantDeckPaths.length === 0) return false;

  let selectedCount = 0;
  for (const descendantPath of descendantDeckPaths) {
    if (descendantPath in selectedDecks) {
      selectedCount += 1;
    }
  }

  if (selectedCount === 0) return false;
  if (selectedCount === descendantDeckPaths.length) return true;
  return "indeterminate";
};

export function DeckList({
  snapshots,
  selectedDecks,
  onToggleDeckSelection,
  onToggleFolderSelection,
  onDeckTitleClick,
  onFolderTitleClick,
}: DeckListProps) {
  const collapsed = useSelector(deckListStore, (s) => s.context.collapsed);

  const tree = useMemo(() => buildDeckTree(snapshots), [snapshots]);
  const groupDescendants = useMemo(() => collectGroupDeckDescendants(tree), [tree]);
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
            checkboxState={
              row.node.kind === "group"
                ? getGroupCheckboxState(groupDescendants.get(row.node.relativePath) ?? [], selectedDecks)
                : row.node.relativePath in selectedDecks
            }
            descendantDeckPaths={groupDescendants.get(row.node.relativePath) ?? []}
            onToggleCollapse={handleToggle}
            onToggleDeckSelection={onToggleDeckSelection}
            onToggleFolderSelection={onToggleFolderSelection}
            onDeckTitleClick={onDeckTitleClick}
            onFolderTitleClick={onFolderTitleClick}
          />
        ))}
      </div>
    </div>
  );
}
