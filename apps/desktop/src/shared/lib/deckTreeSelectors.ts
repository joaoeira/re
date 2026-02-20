import { buildDeckTree } from "@re/workspace";

export type CheckedState = boolean | "indeterminate";

export const collectGroupDeckDescendants = (snapshotsTree: ReturnType<typeof buildDeckTree>) => {
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
