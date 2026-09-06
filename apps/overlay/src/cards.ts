import { readFileSync } from "node:fs";
import { gradeValues, type ReviewGrade } from "./review-controls";
import { cardsPath, writeFileAtomically } from "./storage";

export interface Card {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly cardType?: "qa" | "cloze";
  readonly lastGrade?: ReviewGrade;
}

export function loadCards(): Card[] {
  let raw: string;
  try {
    raw = readFileSync(cardsPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const cards: unknown = JSON.parse(raw);
  if (
    !Array.isArray(cards) ||
    !cards.every(
      (card) =>
        card &&
        typeof card.id === "string" &&
        typeof card.question === "string" &&
        typeof card.answer === "string" &&
        (card.cardType === undefined || card.cardType === "qa" || card.cardType === "cloze") &&
        (card.lastGrade === undefined || Object.hasOwn(gradeValues, card.lastGrade)),
    )
  )
    throw new Error("The scratch card file is invalid. It has not been overwritten.");
  return cards;
}

// Commit before advancing the UI; a failed save keeps the draft/current card.
export function saveCards(cards: readonly Card[]): void {
  writeFileAtomically(cardsPath, JSON.stringify(cards, null, 2) + "\n");
}
