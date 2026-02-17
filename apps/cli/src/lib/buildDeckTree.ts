import type { DeckStats } from "../services/DeckLoader";
import type { Path } from "@effect/platform";

export type DeckTreeNode =
  | {
      readonly type: "folder";
      readonly name: string;
      readonly path: string;
      readonly children: DeckTreeNode[];
    }
  | { readonly type: "deck"; readonly stats: DeckStats };

// Internal mutable node type for building
type BuildNode = {
  type: "folder";
  name: string;
  path: string;
  children: Map<string, BuildNode | { type: "deck"; stats: DeckStats }>;
};

export function buildDeckTree(
  decks: DeckStats[],
  rootPath: string,
  path: Path.Path,
): DeckTreeNode[] {
  const root = new Map<string, BuildNode | { type: "deck"; stats: DeckStats }>();

  for (const stats of decks) {
    const relativePath = path.relative(rootPath, stats.path);
    // Use "/" for splitting - readDirectory returns normalized POSIX paths
    const parts = relativePath.split("/");

    let currentLevel = root;
    let currentPath = rootPath;

    // Create/traverse folder nodes
    // Use "folder:" prefix to avoid collision with files of same name
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      currentPath = path.join(currentPath, part);
      const folderKey = `folder:${part}`;

      let folder = currentLevel.get(folderKey);
      if (!folder || folder.type !== "folder") {
        folder = {
          type: "folder",
          name: part,
          path: currentPath,
          children: new Map(),
        };
        currentLevel.set(folderKey, folder);
      }
      currentLevel = folder.children;
    }

    // Use "file:" prefix for decks
    currentLevel.set(`file:${stats.name}`, { type: "deck", stats });
  }

  // Convert to sorted arrays
  const convertAndSort = (
    nodes: Map<string, BuildNode | { type: "deck"; stats: DeckStats }>,
  ): DeckTreeNode[] => {
    const arr: DeckTreeNode[] = [];
    for (const node of nodes.values()) {
      if (node.type === "folder") {
        arr.push({
          type: "folder",
          name: node.name,
          path: node.path,
          children: convertAndSort(node.children),
        });
      } else {
        arr.push(node);
      }
    }
    // Folders first, then alphabetically
    arr.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      const nameA = a.type === "folder" ? a.name : a.stats.name;
      const nameB = b.type === "folder" ? b.name : b.stats.name;
      return nameA.localeCompare(nameB);
    });
    return arr;
  };

  return convertAndSort(root);
}
