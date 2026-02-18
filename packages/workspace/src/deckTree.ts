import type { DeckSnapshot, DeckStateCounts } from "./snapshotWorkspace";

export type DeckTreeLeaf = {
  readonly kind: "leaf";
  readonly depth: number;
  readonly name: string;
  readonly relativePath: string;
  readonly snapshot: DeckSnapshot;
};

export type DeckTreeGroup = {
  readonly kind: "group";
  readonly depth: number;
  readonly name: string;
  readonly relativePath: string;
  readonly totalCards: number;
  readonly dueCards: number;
  readonly stateCounts: DeckStateCounts;
  readonly errorCount: number;
  readonly children: readonly DeckTreeNode[];
};

export type DeckTreeNode = DeckTreeLeaf | DeckTreeGroup;

export type FlatDeckRow = {
  readonly key: string;
  readonly depth: number;
  readonly node: DeckTreeNode;
};

type MutableGroup = {
  kind: "group";
  depth: number;
  name: string;
  relativePath: string;
  totalCards: number;
  dueCards: number;
  stateCounts: { new: number; learning: number; review: number; relearning: number };
  errorCount: number;
  children: DeckTreeNode[];
};

const addSnapshotCounts = (group: MutableGroup, snapshot: DeckSnapshot): void => {
  if (snapshot.status === "ok") {
    group.totalCards += snapshot.totalCards;
    group.dueCards += snapshot.dueCards;
    group.stateCounts.new += snapshot.stateCounts.new;
    group.stateCounts.learning += snapshot.stateCounts.learning;
    group.stateCounts.review += snapshot.stateCounts.review;
    group.stateCounts.relearning += snapshot.stateCounts.relearning;
  } else {
    group.errorCount += 1;
  }
};

const sortNodes = (nodes: DeckTreeNode[]): void => {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.kind === "group") {
      sortNodes((node as MutableGroup).children);
    }
  }
};

export const buildDeckTree = (snapshots: readonly DeckSnapshot[]): DeckTreeNode[] => {
  const groups = new Map<string, MutableGroup>();
  const rootChildren: DeckTreeNode[] = [];

  const ensureGroup = (segments: readonly string[], upToIndex: number): MutableGroup => {
    const groupPath = segments.slice(0, upToIndex + 1).join("/");
    let group = groups.get(groupPath);
    if (group) return group;

    group = {
      kind: "group",
      depth: upToIndex,
      name: segments[upToIndex]!,
      relativePath: groupPath,
      totalCards: 0,
      dueCards: 0,
      stateCounts: { new: 0, learning: 0, review: 0, relearning: 0 },
      errorCount: 0,
      children: [],
    };
    groups.set(groupPath, group);

    if (upToIndex === 0) {
      rootChildren.push(group);
    } else {
      const parent = ensureGroup(segments, upToIndex - 1);
      parent.children.push(group);
    }

    return group;
  };

  for (const snapshot of snapshots) {
    const segments = snapshot.relativePath.split("/");

    const leaf: DeckTreeLeaf = {
      kind: "leaf",
      depth: segments.length - 1,
      name: snapshot.name,
      relativePath: snapshot.relativePath,
      snapshot,
    };

    if (segments.length === 1) {
      rootChildren.push(leaf);
    } else {
      for (let i = 0; i < segments.length - 1; i++) {
        const group = ensureGroup(segments, i);
        addSnapshotCounts(group, snapshot);
      }
      const parentGroup = groups.get(segments.slice(0, -1).join("/"))!;
      parentGroup.children.push(leaf);
    }
  }

  sortNodes(rootChildren);
  return rootChildren;
};

export const flattenDeckTree = (
  nodes: readonly DeckTreeNode[],
  collapsed: Record<string, true>,
): FlatDeckRow[] => {
  const rows: FlatDeckRow[] = [];

  const walk = (nodeList: readonly DeckTreeNode[]): void => {
    for (const node of nodeList) {
      rows.push({ key: node.relativePath, depth: node.depth, node });

      if (node.kind === "group" && !(node.relativePath in collapsed)) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return rows;
};
