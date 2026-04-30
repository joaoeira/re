import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it, vi } from "vitest";

import { ReviewFooter } from "@/components/review-footer";
import { DEFAULT_REVIEW_SESSION_OPTIONS } from "@shared/rpc/schemas/review";

const baseProps = {
  selectedCount: 0,
  selectedDeckNames: [] as string[],
  metrics: { newCount: 0, dueCount: 0 },
  totalReviewableCards: 0,
  reviewOptions: DEFAULT_REVIEW_SESSION_OPTIONS,
  reviewDisabled: true,
  onReviewOptionsChange: vi.fn(),
  onReview: vi.fn(),
};

describe("ReviewFooter", () => {
  it("shows 'All decks' and 'nothing due' when no selection and no cards", async () => {
    const screen = await render(<ReviewFooter {...baseProps} />);

    await expect.element(screen.getByText("All decks")).toBeVisible();
    await expect.element(screen.getByText("nothing due")).toBeVisible();
  });

  it("shows 'Review all' label when no selection", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
      />,
    );

    await expect.element(screen.getByText("Review all")).toBeVisible();
  });

  it("shows metric counts with labels when cards exist", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
      />,
    );

    await expect.element(screen.getByText("new")).toBeVisible();
    await expect.element(screen.getByText("due")).toBeVisible();
  });

  it("shows selection count when decks are selected", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        selectedCount={3}
        selectedDeckNames={["Rust", "Go", "TypeScript"]}
        metrics={{ newCount: 5, dueCount: 8 }}
        totalReviewableCards={13}
        reviewDisabled={false}
      />,
    );

    await expect.element(screen.getByText("3 decks", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: /Review 3 decks/ })).toBeVisible();
  });

  it("shows single deck name in review label when one deck selected", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        selectedCount={1}
        selectedDeckNames={["Rust"]}
        metrics={{ newCount: 2, dueCount: 3 }}
        totalReviewableCards={5}
        reviewDisabled={false}
      />,
    );

    await expect.element(screen.getByText("Review Rust")).toBeVisible();
    await expect.element(screen.getByText("deck", { exact: false })).toBeVisible();
  });

  it("shows singular 'deck' for single selection count", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        selectedCount={1}
        selectedDeckNames={["Rust"]}
        metrics={{ newCount: 2, dueCount: 3 }}
        totalReviewableCards={5}
        reviewDisabled={false}
      />,
    );

    await expect.element(screen.getByText(/\b1\b.*\bdeck\b/)).toBeVisible();
  });

  it("disables review button when reviewDisabled is true", async () => {
    const screen = await render(
      <ReviewFooter {...baseProps} selectedCount={2} selectedDeckNames={["A", "B"]} />,
    );

    await expect.element(screen.getByRole("button", { name: /Review 2 decks/ })).toBeDisabled();
  });

  it("calls onReview when review button is clicked", async () => {
    const onReview = vi.fn();
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
        onReview={onReview}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Review all/ }));
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("does not call onReview when review button is disabled", async () => {
    const onReview = vi.fn();
    const screen = await render(<ReviewFooter {...baseProps} onReview={onReview} />);

    const button = screen.getByRole("button", { name: /Review all/ });
    await expect.element(button).toBeDisabled();
    (button.element() as HTMLElement).click();
    expect(onReview).not.toHaveBeenCalled();
  });

  it("shows Space keyboard hint when cards are reviewable", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
      />,
    );

    await expect.element(screen.getByText("Space")).toBeVisible();
  });

  it("hides Space hint when no cards are reviewable", async () => {
    const screen = await render(<ReviewFooter {...baseProps} />);

    expect(screen.getByText("Space").query()).toBeNull();
  });

  it("calls onReview when Space is pressed", async () => {
    const onReview = vi.fn();
    await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
        onReview={onReview}
      />,
    );

    await userEvent.keyboard(" ");
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("does not call onReview when Space is pressed and review is disabled", async () => {
    const onReview = vi.fn();
    await render(<ReviewFooter {...baseProps} onReview={onReview} />);

    await userEvent.keyboard(" ");
    expect(onReview).not.toHaveBeenCalled();
  });

  it("does not call onReview when Space is pressed with modifier keys", async () => {
    const onReview = vi.fn();
    await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
        onReview={onReview}
      />,
    );

    await userEvent.keyboard("{Control>} {/Control}");
    await userEvent.keyboard("{Meta>} {/Meta}");
    await userEvent.keyboard("{Alt>} {/Alt}");
    expect(onReview).not.toHaveBeenCalled();
  });

  it("shows total card count on the review button", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
      />,
    );

    await expect.element(screen.getByText("8", { exact: true })).toBeVisible();
  });

  it("shows an icon-only review options trigger for default sessions", async () => {
    const screen = await render(<ReviewFooter {...baseProps} />);

    await expect
      .element(screen.getByRole("button", { name: "Review session options" }))
      .toBeVisible();
    expect(screen.getByText("Custom").query()).toBeNull();
  });

  it("shows a Custom review options trigger when options differ from defaults", async () => {
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        reviewOptions={{ ...DEFAULT_REVIEW_SESSION_OPTIONS, cardLimit: 20 }}
      />,
    );

    await expect
      .element(screen.getByRole("button", { name: "Review session options, custom" }))
      .toBeVisible();
    await expect.element(screen.getByText("Custom")).toBeVisible();
  });

  it("calls onReviewOptionsChange when changing order in the popover", async () => {
    const onReviewOptionsChange = vi.fn();
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
        onReviewOptionsChange={onReviewOptionsChange}
      />,
    );

    (
      screen.getByRole("button", { name: "Review session options" }).element() as HTMLElement
    ).click();
    await expect.element(screen.getByText("Review options")).toBeVisible();
    (screen.getByRole("button", { name: "Due first" }).element() as HTMLElement).click();

    expect(onReviewOptionsChange).toHaveBeenCalledWith({
      ...DEFAULT_REVIEW_SESSION_OPTIONS,
      order: "due-first",
    });
  });

  it("does not call onReview when Space is pressed while options are open", async () => {
    const onReview = vi.fn();
    const screen = await render(
      <ReviewFooter
        {...baseProps}
        metrics={{ newCount: 3, dueCount: 5 }}
        totalReviewableCards={8}
        reviewDisabled={false}
        onReview={onReview}
      />,
    );

    (
      screen.getByRole("button", { name: "Review session options" }).element() as HTMLElement
    ).click();
    await expect.element(screen.getByText("Review options")).toBeVisible();

    await userEvent.keyboard(" ");

    expect(onReview).not.toHaveBeenCalled();
  });
});
