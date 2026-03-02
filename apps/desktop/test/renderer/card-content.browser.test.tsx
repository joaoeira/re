import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import { CardContent } from "@/components/review-session/card-content";

describe("CardContent", () => {
  const qaCard = { prompt: "What is 2+2?", reveal: "4", cardType: "qa" as const };
  const clozeCard = {
    prompt: "The capital of France is {{c1::...}}",
    reveal: "The capital of France is {{c1::Paris}}",
    cardType: "cloze" as const,
  };

  describe("deck name eyebrow", () => {
    it("renders the deck name as an uppercase label", async () => {
      const screen = await render(
        <CardContent card={qaCard} deckName="spanish-vocab" isRevealed={false} />,
      );

      await expect.element(screen.getByText("SPANISH VOCAB")).toBeVisible();
    });

    it("replaces hyphens and underscores with spaces", async () => {
      const screen = await render(
        <CardContent card={qaCard} deckName="european_history-notes" isRevealed={false} />,
      );

      await expect.element(screen.getByText("EUROPEAN HISTORY NOTES")).toBeVisible();
    });

    it("renders the eyebrow for cloze cards", async () => {
      const screen = await render(
        <CardContent card={clozeCard} deckName="geography" isRevealed={false} />,
      );

      await expect.element(screen.getByText("GEOGRAPHY")).toBeVisible();
    });

    it("persists the eyebrow when the answer is revealed", async () => {
      const screen = await render(
        <CardContent card={qaCard} deckName="physics" isRevealed={true} />,
      );

      await expect.element(screen.getByText("PHYSICS")).toBeVisible();
    });
  });

  describe("qa card", () => {
    it("shows the prompt when not revealed", async () => {
      const screen = await render(<CardContent card={qaCard} deckName="deck" isRevealed={false} />);

      await expect.element(screen.getByText("What is 2+2?")).toBeVisible();
      expect(screen.getByText("4").query()).toBeNull();
    });

    it("shows both prompt and answer when revealed", async () => {
      const screen = await render(<CardContent card={qaCard} deckName="deck" isRevealed={true} />);

      await expect.element(screen.getByText("What is 2+2?")).toBeVisible();
      await expect.element(screen.getByText("4")).toBeVisible();
    });
  });

  describe("cloze card", () => {
    it("shows the prompt when not revealed", async () => {
      const screen = await render(
        <CardContent card={clozeCard} deckName="deck" isRevealed={false} />,
      );

      await expect.element(screen.getByText(/capital of France/)).toBeVisible();
    });

    it("shows the reveal text when revealed", async () => {
      const screen = await render(
        <CardContent card={clozeCard} deckName="deck" isRevealed={true} />,
      );

      await expect.element(screen.getByText(/Paris/)).toBeVisible();
    });
  });
});
