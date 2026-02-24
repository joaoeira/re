import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { DeckInlineMetrics } from "@/components/deck-list/deck-inline-metrics";

describe("DeckInlineMetrics", () => {
  it("renders counts only for non-zero values", async () => {
    const screen = await render(<DeckInlineMetrics newCount={3} dueCount={2} />);

    await expect.element(screen.getByText("3", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("2", { exact: true })).toBeVisible();
  });

  it("renders only new when due is zero", async () => {
    const screen = await render(<DeckInlineMetrics newCount={5} dueCount={0} />);

    await expect.element(screen.getByText("5", { exact: true })).toBeVisible();
    expect(screen.getByText("0").query()).toBeNull();
  });

  it("renders nothing when all counts are zero", async () => {
    const { container } = await render(<DeckInlineMetrics newCount={0} dueCount={0} />);

    expect(container.innerHTML).toBe("");
  });

  it("has an aria-label describing the counts", async () => {
    const screen = await render(<DeckInlineMetrics newCount={3} dueCount={7} />);

    await expect.element(screen.getByLabelText("3 new, 7 due")).toBeVisible();
  });
});
