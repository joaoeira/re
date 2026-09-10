import type { ReviewDeckIssue } from "@simbyotic/re/study";
import { CardMarkdown } from "../card-markdown";
import type { ReviewGrade } from "../review-controls";
import { colors, column, divider, row, type } from "../theme";
import { Action } from "../ui/action";
import { cardBody } from "./preview-screen";

export type ReviewView =
  | { readonly kind: "startError"; readonly error: string }
  | { readonly kind: "loadingCard" }
  | { readonly kind: "cardError"; readonly error: string; readonly deckPath?: string }
  | {
      readonly kind: "card";
      readonly cardType: "qa" | "cloze";
      readonly prompt: string;
      readonly reveal: string;
      readonly revealed: boolean;
      readonly deckPath?: string;
    }
  | { readonly kind: "loading" }
  | { readonly kind: "complete"; readonly grades: readonly ReviewGrade[] }
  | { readonly kind: "empty" };

export interface ReviewScreenProps {
  readonly view: ReviewView;
  readonly issues: readonly ReviewDeckIssue[];
  readonly onOpenDeck: () => void;
  readonly onChooseWorkspace: () => void;
}

const count = (grades: readonly ReviewGrade[], grade: ReviewGrade) =>
  grades.filter((entry) => entry === grade).length;

export const reviewCount = (grades: readonly ReviewGrade[]) =>
  `${grades.length} ${grades.length === 1 ? "card" : "cards"} reviewed`;
export const reviewBreakdown = (grades: readonly ReviewGrade[]) =>
  `Again ${count(grades, "again")} · Hard ${count(grades, "hard")} · Good ${count(grades, "good")} · Easy ${count(grades, "easy")}`;

const centered = {
  ...column,
  flexGrow: 1,
  justifyContent: "center",
  paddingLeft: cardBody.paddingLeft,
  paddingRight: cardBody.paddingRight,
  paddingBottom: 24,
} as const;

export function ReviewScreen({ view, issues, onOpenDeck, onChooseWorkspace }: ReviewScreenProps) {
  switch (view.kind) {
    case "startError":
      return (
        <div style={cardBody}>
          <div style={{ ...column, gap: 17 }}>
            <text style={{ ...type.heading, color: colors.error }}>Could not start review</text>
            <text style={{ ...type.input, color: colors.muted }}>{view.error}</text>
          </div>
          <div style={{ ...row, marginLeft: -6, marginTop: -10 }}>
            <Action label="Choose workspace…" onClick={onChooseWorkspace} />
          </div>
        </div>
      );
    case "cardError":
      return (
        <div style={cardBody}>
          <div style={{ ...column, gap: 17 }}>
            <text style={{ ...type.heading, color: colors.error }}>Could not load this card</text>
            <div style={{ ...column, gap: 11 }}>
              <text style={{ ...type.input, color: colors.muted }}>{view.error}</text>
              {view.deckPath && (
                <text style={{ ...type.label, color: colors.muted }}>{view.deckPath}</text>
              )}
            </div>
          </div>
          <div style={{ ...row, marginLeft: -6, marginTop: -10 }}>
            <Action label="Open deck" keys="⌘ O" onClick={onOpenDeck} />
          </div>
        </div>
      );
    case "card": {
      const clozeRevealed = view.revealed && view.cardType === "cloze";
      return (
        <div style={cardBody}>
          <CardMarkdown
            testId={clozeRevealed ? "revealed-answer" : "prompt"}
            source={clozeRevealed ? view.reveal : view.prompt}
            deckPath={view.deckPath}
          />
          {view.revealed && view.cardType === "qa" && (
            <>
              <div style={divider} />
              <CardMarkdown
                testId="revealed-answer"
                source={view.reveal}
                deckPath={view.deckPath}
              />
            </>
          )}
          {issues.length > 0 && <Issues issues={issues} />}
        </div>
      );
    }
    case "loadingCard":
    case "loading":
      return (
        <div style={centered}>
          <text style={{ ...type.input, color: colors.muted }}>
            {view.kind === "loading" ? "Loading cards…" : "Loading card…"}
          </text>
        </div>
      );
    case "complete":
      return (
        <div style={centered}>
          <div style={{ ...column, gap: 13 }}>
            <text style={{ ...type.display, color: colors.text }}>Review complete</text>
            <div style={{ ...column, gap: 14 }}>
              <text style={{ ...type.input, color: colors.muted }}>{reviewCount(view.grades)}</text>
              <text style={{ ...type.body, color: colors.muted }}>
                {reviewBreakdown(view.grades)}
              </text>
            </div>
          </div>
          {issues.length > 0 && <Issues issues={issues} />}
        </div>
      );
    case "empty":
      return (
        <div style={centered}>
          <div style={{ ...column, gap: 13 }}>
            <text style={{ ...type.display, color: colors.text }}>No cards due</text>
            <text style={{ ...type.input, color: colors.muted }}>
              There are no reviewable new or due cards.
            </text>
          </div>
          {issues.length > 0 && <Issues issues={issues} />}
        </div>
      );
  }
}

function Issues({ issues }: { readonly issues: readonly ReviewDeckIssue[] }) {
  return (
    <>
      <div style={divider} />
      <div style={{ ...column, gap: 11 }}>
        <text style={{ ...type.body, color: colors.error }}>Some decks or cards were excluded</text>
        {issues.map((issue, index) => (
          <text key={index} style={{ ...type.label, color: colors.muted }}>
            {`${issue.relativePath}: ${issue.message}`}
          </text>
        ))}
      </div>
    </>
  );
}
