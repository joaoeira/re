import { userEvent } from "@vitest/browser/context";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { SelectionToolbar } from "@/components/selection-toolbar";

describe("SelectionToolbar", () => {
  it("shows cards due and enabled review button when no selection with cards due", async () => {
    const screen = await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={5}
        reviewDisabled={false}
        onClearSelection={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("5 cards due")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).not.toBeDisabled();
    expect(screen.getByText("selected").query()).toBeNull();
    expect(screen.getByRole("button", { name: "Clear deck selection" }).query()).toBeNull();
  });

  it("shows zero cards due and disabled review button when nothing is due", async () => {
    const screen = await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={0}
        reviewDisabled={true}
        onClearSelection={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("0 cards due")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("shows selection count, cards due, and clear button when decks are selected", async () => {
    const screen = await render(
      <SelectionToolbar
        selectedCount={3}
        reviewableCount={10}
        reviewDisabled={false}
        onClearSelection={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("3 selected")).toBeVisible();
    await expect.element(screen.getByText("10 cards due")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Clear deck selection" }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).not.toBeDisabled();
  });

  it("disables review button when selection has zero reviewable cards", async () => {
    const screen = await render(
      <SelectionToolbar
        selectedCount={2}
        reviewableCount={0}
        reviewDisabled={true}
        onClearSelection={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("2 selected")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("calls onClearSelection when clear button is clicked", async () => {
    const onClearSelection = vi.fn();
    const screen = await render(
      <SelectionToolbar
        selectedCount={3}
        reviewableCount={10}
        reviewDisabled={false}
        onClearSelection={onClearSelection}
        onReview={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Clear deck selection" }));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it("calls onReview when review button is clicked", async () => {
    const onReview = vi.fn();
    const screen = await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={5}
        reviewDisabled={false}
        onClearSelection={vi.fn()}
        onReview={onReview}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("does not call onReview when review button is disabled", async () => {
    const onReview = vi.fn();
    const screen = await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={0}
        reviewDisabled={true}
        onClearSelection={vi.fn()}
        onReview={onReview}
      />,
    );

    const button = screen.getByRole("button", { name: "Review" });
    await expect.element(button).toBeDisabled();
    (button.element() as HTMLElement).click();
    expect(onReview).not.toHaveBeenCalled();
  });
});
