import type { ComponentProps } from "react";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { CardBlock } from "@/components/forge/cards/card-block";
import type { ForgeGeneratedCard } from "@shared/rpc/schemas/forge";

type CardBlockProps = ComponentProps<typeof CardBlock>;

const baseCard: ForgeGeneratedCard = {
  id: 8_901,
  question: "What is photosynthesis?",
  answer: "It converts light energy into chemical energy.",
  addedToDeck: false,
};

const makeProps = (overrides: Partial<CardBlockProps> = {}): CardBlockProps => ({
  card: baseCard,
  isAdded: false,
  isAdding: false,
  addDisabled: false,
  expandedPanel: null,
  expansionStatus: "idle",
  isReformulating: false,
  reformulateErrorMessage: null,
  onAdd: vi.fn(),
  onDelete: vi.fn(),
  onReformulate: vi.fn(),
  onTogglePermutations: vi.fn(),
  onToggleCloze: vi.fn(),
  onRequestExpansion: vi.fn(),
  onEditQuestion: vi.fn(),
  onEditAnswer: vi.fn(),
  ...overrides,
});

describe("CardBlock", () => {
  it("renders card content and an enabled Add to deck button for unadded cards", async () => {
    const screen = await render(<CardBlock {...makeProps()} />);

    await expect.element(screen.getByText("What is photosynthesis?")).toBeVisible();
    await expect
      .element(screen.getByText("It converts light energy into chemical energy."))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Add to deck" })).toBeEnabled();
  });

  it("calls onAdd when Add to deck is clicked", async () => {
    const onAdd = vi.fn();
    const screen = await render(<CardBlock {...makeProps({ onAdd })} />);

    await userEvent.click(screen.getByRole("button", { name: "Add to deck" }));

    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("shows a disabled Card added button and keeps the Added to deck label when already added", async () => {
    const onAdd = vi.fn();
    const screen = await render(<CardBlock {...makeProps({ isAdded: true, onAdd })} />);

    const cardAddedButton = screen.getByRole("button", { name: "Card added" });
    await expect.element(cardAddedButton).toBeVisible();
    await expect.element(cardAddedButton).toBeDisabled();

    (cardAddedButton.element() as HTMLElement).click();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("disables Add to deck while an add request is in flight", async () => {
    const screen = await render(<CardBlock {...makeProps({ isAdding: true })} />);

    await expect.element(screen.getByRole("button", { name: "Add to deck" })).toBeDisabled();
  });

  it("disables Add to deck when addDisabled is true", async () => {
    const screen = await render(<CardBlock {...makeProps({ addDisabled: true })} />);

    await expect.element(screen.getByRole("button", { name: "Add to deck" })).toBeDisabled();
  });

  it("calls permutations, cloze, reformulate, and delete callbacks", async () => {
    const onTogglePermutations = vi.fn();
    const onToggleCloze = vi.fn();
    const onReformulate = vi.fn();
    const onDelete = vi.fn();
    const screen = await render(
      <CardBlock
        {...makeProps({
          onTogglePermutations,
          onToggleCloze,
          onReformulate,
          onDelete,
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Permutations" }));
    await userEvent.click(screen.getByRole("button", { name: "Cloze" }));
    await userEvent.click(screen.getByRole("button", { name: "Reformulate card" }));

    const deleteButton = screen.container.querySelector(
      "button[data-slot='button'].text-destructive",
    );
    if (!(deleteButton instanceof HTMLButtonElement)) {
      throw new Error("Expected delete button.");
    }
    deleteButton.click();

    expect(onTogglePermutations).toHaveBeenCalledOnce();
    expect(onToggleCloze).toHaveBeenCalledOnce();
    expect(onReformulate).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("pulses and disables reformulate while a reformulation request is in flight", async () => {
    const screen = await render(<CardBlock {...makeProps({ isReformulating: true })} />);

    await expect.element(screen.getByRole("button", { name: "Reformulate card" })).toBeDisabled();
    expect(screen.container.firstElementChild?.className).toContain("animate-pulse");
    expect(screen.container.firstElementChild?.className).toContain("pointer-events-none");
  });
});
