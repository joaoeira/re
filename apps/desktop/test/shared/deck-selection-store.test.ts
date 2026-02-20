import { beforeEach, describe, expect, it } from "vitest";

import { createDeckSelectionStore } from "@shared/state/deckSelectionStore";
import { getGroupCheckboxState } from "@shared/lib/deckTreeSelectors";

let deckSelectionStore: ReturnType<typeof createDeckSelectionStore>;

const selectedKeys = () => Object.keys(deckSelectionStore.getSnapshot().context.selected).sort();

describe("deckSelectionStore", () => {
  beforeEach(() => {
    deckSelectionStore = createDeckSelectionStore();
  });

  it("toggles single deck selection on and off", () => {
    deckSelectionStore.send({ type: "toggleDeck", path: "deck-a.md" });
    expect(selectedKeys()).toEqual(["deck-a.md"]);

    deckSelectionStore.send({ type: "toggleDeck", path: "deck-a.md" });
    expect(selectedKeys()).toEqual([]);
  });

  it("toggles folder descendants as a group", () => {
    deckSelectionStore.send({
      type: "toggleFolder",
      path: "folder",
      descendantPaths: ["folder/a.md", "folder/b.md"],
    });
    expect(selectedKeys()).toEqual(["folder/a.md", "folder/b.md"]);

    deckSelectionStore.send({
      type: "toggleFolder",
      path: "folder",
      descendantPaths: ["folder/a.md", "folder/b.md"],
    });
    expect(selectedKeys()).toEqual([]);
  });

  it("clears all selections", () => {
    deckSelectionStore.send({ type: "toggleDeck", path: "deck-a.md" });
    deckSelectionStore.send({ type: "toggleDeck", path: "deck-b.md" });
    expect(selectedKeys()).toEqual(["deck-a.md", "deck-b.md"]);

    deckSelectionStore.send({ type: "clear" });
    expect(selectedKeys()).toEqual([]);
  });

  it("supports partial deselection and reselect for folder descendants", () => {
    deckSelectionStore.send({
      type: "toggleFolder",
      path: "folder",
      descendantPaths: ["folder/a.md", "folder/b.md", "folder/c.md"],
    });
    expect(selectedKeys()).toEqual(["folder/a.md", "folder/b.md", "folder/c.md"]);

    deckSelectionStore.send({ type: "toggleDeck", path: "folder/b.md" });
    expect(selectedKeys()).toEqual(["folder/a.md", "folder/c.md"]);

    deckSelectionStore.send({
      type: "toggleFolder",
      path: "folder",
      descendantPaths: ["folder/a.md", "folder/b.md", "folder/c.md"],
    });
    expect(selectedKeys()).toEqual(["folder/a.md", "folder/b.md", "folder/c.md"]);
  });

  it("derives group checkbox states correctly", () => {
    const descendants = ["folder/a.md", "folder/b.md", "folder/c.md"] as const;

    expect(getGroupCheckboxState(descendants, {})).toBe(false);
    expect(getGroupCheckboxState(descendants, { "folder/a.md": true })).toBe("indeterminate");
    expect(
      getGroupCheckboxState(descendants, {
        "folder/a.md": true,
        "folder/b.md": true,
        "folder/c.md": true,
      }),
    ).toBe(true);
  });
});
