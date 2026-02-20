import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { SelectionToolbar } from "@/components/selection-toolbar";

describe("SelectionToolbar", () => {
  it("renders nothing when no selection and no cards due", async () => {
    const screen = await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={0}
        reviewDisabled={true}
        onClearSelection={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Review" }).query()).toBeNull();
  });

  it("shows due count and review button when cards are due without selection", async () => {
    const screen = await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={5}
        reviewDisabled={false}
        onClearSelection={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("5 due")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).not.toBeDisabled();
    expect(screen.getByText("selected").query()).toBeNull();
    expect(screen.getByRole("button", { name: "Clear deck selection" }).query()).toBeNull();
  });

  it("shows selection count, due count, and clear button when decks are selected", async () => {
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
    await expect.element(screen.getByText("10 due")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Clear deck selection" }))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Review" })).not.toBeDisabled();
  });

  it("shows toolbar when decks selected even with zero due", async () => {
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
        selectedCount={2}
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

  it("shows the Space keyboard hint on the review button", async () => {
    const screen = await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={5}
        reviewDisabled={false}
        onClearSelection={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    await expect.element(screen.getByText("Space")).toBeVisible();
  });

  it("calls onReview when Space is pressed", async () => {
    const onReview = vi.fn();
    await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={5}
        reviewDisabled={false}
        onClearSelection={vi.fn()}
        onReview={onReview}
      />,
    );

    await userEvent.keyboard(" ");
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("does not call onReview when Space is pressed and review is disabled", async () => {
    const onReview = vi.fn();
    await render(
      <SelectionToolbar
        selectedCount={2}
        reviewableCount={0}
        reviewDisabled={true}
        onClearSelection={vi.fn()}
        onReview={onReview}
      />,
    );

    await userEvent.keyboard(" ");
    expect(onReview).not.toHaveBeenCalled();
  });

  it("does not register Space handler when toolbar is hidden", async () => {
    const onReview = vi.fn();
    await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={0}
        reviewDisabled={true}
        onClearSelection={vi.fn()}
        onReview={onReview}
      />,
    );

    await userEvent.keyboard(" ");
    expect(onReview).not.toHaveBeenCalled();
  });

  it("does not call onReview when Space is pressed with modifier keys", async () => {
    const onReview = vi.fn();
    await render(
      <SelectionToolbar
        selectedCount={0}
        reviewableCount={5}
        reviewDisabled={false}
        onClearSelection={vi.fn()}
        onReview={onReview}
      />,
    );

    await userEvent.keyboard("{Control>} {/Control}");
    await userEvent.keyboard("{Meta>} {/Meta}");
    await userEvent.keyboard("{Alt>} {/Alt}");
    expect(onReview).not.toHaveBeenCalled();
  });
});
