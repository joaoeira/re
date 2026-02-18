import { describe, expect, it } from "vitest";

import { buildDeckTree, flattenDeckTree, type DeckTreeGroup, type DeckTreeLeaf } from "../src";
import type { DeckSnapshot, DeckStateCounts } from "../src/snapshotWorkspace";

const okSnapshot = (
  relativePath: string,
  counts?: Partial<DeckStateCounts>,
  dueCards?: number,
): DeckSnapshot => {
  const stateCounts = {
    new: 0,
    learning: 0,
    review: 0,
    relearning: 0,
    ...counts,
  };
  return {
    status: "ok",
    absolutePath: `/root/${relativePath}`,
    relativePath,
    name: relativePath.split("/").pop()!.replace(/\.md$/i, ""),
    totalCards:
      stateCounts.new + stateCounts.learning + stateCounts.review + stateCounts.relearning,
    dueCards: dueCards ?? 0,
    stateCounts,
  };
};

const errorSnapshot = (
  relativePath: string,
  status: "read_error" | "parse_error" = "parse_error",
): DeckSnapshot => ({
  status,
  absolutePath: `/root/${relativePath}`,
  relativePath,
  name: relativePath.split("/").pop()!.replace(/\.md$/i, ""),
  message: `Error in ${relativePath}`,
});

describe("buildDeckTree", () => {
  it("returns empty array for empty input", () => {
    expect(buildDeckTree([])).toEqual([]);
  });

  it("creates a leaf at depth 0 for a root-level deck", () => {
    const snapshot = okSnapshot("vocab.md", { new: 5 });
    const tree = buildDeckTree([snapshot]);

    expect(tree).toHaveLength(1);
    const leaf = tree[0] as DeckTreeLeaf;
    expect(leaf.kind).toBe("leaf");
    expect(leaf.depth).toBe(0);
    expect(leaf.name).toBe("vocab");
    expect(leaf.relativePath).toBe("vocab.md");
    expect(leaf.snapshot).toBe(snapshot);
  });

  it("sorts multiple root-level decks alphabetically", () => {
    const tree = buildDeckTree([
      okSnapshot("zebra.md"),
      okSnapshot("alpha.md"),
      okSnapshot("middle.md"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("creates a group for a single nested deck", () => {
    const snapshot = okSnapshot("lang/vocab.md", { new: 3, review: 7 }, 2);
    const tree = buildDeckTree([snapshot]);

    expect(tree).toHaveLength(1);
    const group = tree[0] as DeckTreeGroup;
    expect(group.kind).toBe("group");
    expect(group.depth).toBe(0);
    expect(group.name).toBe("lang");
    expect(group.relativePath).toBe("lang");
    expect(group.totalCards).toBe(10);
    expect(group.dueCards).toBe(2);
    expect(group.stateCounts).toEqual({ new: 3, learning: 0, review: 7, relearning: 0 });
    expect(group.errorCount).toBe(0);

    expect(group.children).toHaveLength(1);
    const leaf = group.children[0] as DeckTreeLeaf;
    expect(leaf.kind).toBe("leaf");
    expect(leaf.depth).toBe(1);
    expect(leaf.name).toBe("vocab");
  });

  it("creates nested groups for deeply nested paths", () => {
    const snapshot = okSnapshot("a/b/c/deck.md", { new: 1 });
    const tree = buildDeckTree([snapshot]);

    const groupA = tree[0] as DeckTreeGroup;
    expect(groupA.name).toBe("a");
    expect(groupA.depth).toBe(0);
    expect(groupA.totalCards).toBe(1);
    expect(groupA.dueCards).toBe(0);

    const groupB = groupA.children[0] as DeckTreeGroup;
    expect(groupB.name).toBe("b");
    expect(groupB.depth).toBe(1);
    expect(groupB.totalCards).toBe(1);

    const groupC = groupB.children[0] as DeckTreeGroup;
    expect(groupC.name).toBe("c");
    expect(groupC.depth).toBe(2);
    expect(groupC.totalCards).toBe(1);

    const leaf = groupC.children[0] as DeckTreeLeaf;
    expect(leaf.kind).toBe("leaf");
    expect(leaf.depth).toBe(3);
  });

  it("aggregates counts from multiple children in the same group", () => {
    const tree = buildDeckTree([
      okSnapshot("math/algebra.md", { new: 5, review: 3 }, 2),
      okSnapshot("math/calculus.md", { new: 2, learning: 4 }, 1),
    ]);

    const group = tree[0] as DeckTreeGroup;
    expect(group.totalCards).toBe(14);
    expect(group.dueCards).toBe(3);
    expect(group.stateCounts).toEqual({
      new: 7,
      learning: 4,
      review: 3,
      relearning: 0,
    });
    expect(group.children).toHaveLength(2);
  });

  it("aggregates counts through all ancestor groups", () => {
    const tree = buildDeckTree([okSnapshot("a/b/deep.md", { new: 10 }, 4)]);

    const groupA = tree[0] as DeckTreeGroup;
    expect(groupA.totalCards).toBe(10);
    expect(groupA.dueCards).toBe(4);
    expect(groupA.stateCounts.new).toBe(10);

    const groupB = groupA.children[0] as DeckTreeGroup;
    expect(groupB.totalCards).toBe(10);
    expect(groupB.dueCards).toBe(4);
    expect(groupB.stateCounts.new).toBe(10);
  });

  it("increments errorCount for error snapshots without adding card counts", () => {
    const tree = buildDeckTree([
      okSnapshot("lang/good.md", { new: 5 }, 2),
      errorSnapshot("lang/bad.md", "parse_error"),
      errorSnapshot("lang/broken.md", "read_error"),
    ]);

    const group = tree[0] as DeckTreeGroup;
    expect(group.totalCards).toBe(5);
    expect(group.dueCards).toBe(2);
    expect(group.stateCounts.new).toBe(5);
    expect(group.errorCount).toBe(2);
  });

  it("sorts groups before leaves at the same level", () => {
    const tree = buildDeckTree([okSnapshot("root-deck.md"), okSnapshot("folder/nested.md")]);

    expect(tree[0]!.kind).toBe("group");
    expect(tree[0]!.name).toBe("folder");
    expect(tree[1]!.kind).toBe("leaf");
    expect(tree[1]!.name).toBe("root-deck");
  });

  it("handles mixed root and nested decks", () => {
    const tree = buildDeckTree([
      okSnapshot("standalone.md", { review: 1 }),
      okSnapshot("cs/algo.md", { new: 2 }),
      okSnapshot("cs/ds.md", { new: 3 }),
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]!.kind).toBe("group");
    expect(tree[0]!.name).toBe("cs");
    expect(tree[1]!.kind).toBe("leaf");
    expect(tree[1]!.name).toBe("standalone");
  });

  it("handles a group with only error children", () => {
    const tree = buildDeckTree([errorSnapshot("broken/a.md"), errorSnapshot("broken/b.md")]);

    const group = tree[0] as DeckTreeGroup;
    expect(group.totalCards).toBe(0);
    expect(group.dueCards).toBe(0);
    expect(group.stateCounts).toEqual({ new: 0, learning: 0, review: 0, relearning: 0 });
    expect(group.errorCount).toBe(2);
  });
});

describe("flattenDeckTree", () => {
  const tree = buildDeckTree([
    okSnapshot("algorithms/graphs/bfs.md", { new: 3 }),
    okSnapshot("algorithms/graphs/dfs.md", { new: 2 }),
    okSnapshot("algorithms/sorting.md", { review: 5 }),
    okSnapshot("japanese/vocab.md", { new: 10 }),
  ]);

  it("returns all nodes in DFS order when fully expanded", () => {
    const rows = flattenDeckTree(tree, {});

    expect(rows.map((r) => r.key)).toEqual([
      "algorithms",
      "algorithms/graphs",
      "algorithms/graphs/bfs.md",
      "algorithms/graphs/dfs.md",
      "algorithms/sorting.md",
      "japanese",
      "japanese/vocab.md",
    ]);
  });

  it("assigns correct depths", () => {
    const rows = flattenDeckTree(tree, {});

    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1, 0, 1]);
  });

  it("skips children of collapsed groups but keeps the group row", () => {
    const rows = flattenDeckTree(tree, { algorithms: true } as Record<string, true>);

    expect(rows.map((r) => r.key)).toEqual(["algorithms", "japanese", "japanese/vocab.md"]);
  });

  it("collapses a nested group while keeping its parent expanded", () => {
    const rows = flattenDeckTree(tree, { "algorithms/graphs": true } as Record<string, true>);

    expect(rows.map((r) => r.key)).toEqual([
      "algorithms",
      "algorithms/graphs",
      "algorithms/sorting.md",
      "japanese",
      "japanese/vocab.md",
    ]);
  });

  it("returns empty array for empty tree", () => {
    expect(flattenDeckTree([], {})).toEqual([]);
  });

  it("returns all rows when collapsed record is empty (expand all)", () => {
    const rows = flattenDeckTree(tree, {});
    expect(rows).toHaveLength(7);
  });

  it("returns only top-level rows when all groups are collapsed", () => {
    const collapsed = {
      algorithms: true,
      "algorithms/graphs": true,
      japanese: true,
    } as Record<string, true>;

    const rows = flattenDeckTree(tree, collapsed);
    expect(rows.map((r) => r.key)).toEqual(["algorithms", "japanese"]);
  });
});
