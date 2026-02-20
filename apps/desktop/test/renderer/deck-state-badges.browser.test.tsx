import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { DeckStateBadges } from "@/components/deck-list/deck-state-badges";

describe("DeckStateBadges", () => {
  it("renders badges only for non-zero counts", async () => {
    const screen = await render(
      <DeckStateBadges stateCounts={{ new: 3, learning: 0, review: 2, relearning: 0 }} />,
    );

    await expect.element(screen.getByTitle("New")).toBeVisible();
    await expect.element(screen.getByTitle("Review")).toBeVisible();
    expect(screen.getByTitle("Learning").query()).toBeNull();
    expect(screen.getByTitle("Relearning").query()).toBeNull();
  });

  it("displays the correct counts", async () => {
    const screen = await render(
      <DeckStateBadges stateCounts={{ new: 5, learning: 1, review: 10, relearning: 2 }} />,
    );

    await expect.element(screen.getByTitle("New")).toHaveTextContent("5");
    await expect.element(screen.getByTitle("Learning", { exact: true })).toHaveTextContent("1");
    await expect.element(screen.getByTitle("Review")).toHaveTextContent("10");
    await expect.element(screen.getByTitle("Relearning")).toHaveTextContent("2");
  });

  it("renders nothing when all counts are zero", async () => {
    const screen = await render(
      <DeckStateBadges stateCounts={{ new: 0, learning: 0, review: 0, relearning: 0 }} />,
    );

    expect(screen.getByTitle("New").query()).toBeNull();
    expect(screen.getByTitle("Learning").query()).toBeNull();
    expect(screen.getByTitle("Review").query()).toBeNull();
    expect(screen.getByTitle("Relearning").query()).toBeNull();
  });
});
