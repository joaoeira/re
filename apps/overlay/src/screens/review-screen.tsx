import type { ReviewDeckIssue } from "@simbyotic/re/study";
import { CardMarkdown } from "../card-markdown";
import type { ReviewGrade } from "../review-controls";
import { colors, column, font } from "../theme";
import { Action } from "../ui/action";

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
  readonly onRestart: () => void;
  readonly onReloadCard: () => void;
  readonly onSkipCard: () => void;
  readonly onOpenDeck: () => void;
  readonly onChooseWorkspace: () => void;
}

const hasCard = (view: ReviewView) =>
  view.kind === "card" || view.kind === "loadingCard" || view.kind === "cardError";

const count = (grades: readonly ReviewGrade[], grade: ReviewGrade) =>
  grades.filter((entry) => entry === grade).length;

export const reviewSummary = (grades: readonly ReviewGrade[]) =>
  `Reviewed ${grades.length} ${grades.length === 1 ? "card" : "cards"}. Again: ${count(grades, "again")} · Hard: ${count(grades, "hard")} · Good: ${count(grades, "good")} · Easy: ${count(grades, "easy")}`;

export function ReviewScreen({
  view,
  issues,
  onRestart,
  onReloadCard,
  onSkipCard,
  onOpenDeck,
  onChooseWorkspace,
}: ReviewScreenProps) {
  return (
    <div style={{ ...column, flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
      <div
        style={{
          ...column,
          flexShrink: 0,
          flexGrow: hasCard(view) ? 0 : 1,
          paddingLeft: 38,
          paddingRight: 38,
          paddingBottom: 24,
          paddingTop: 16,
          gap: 16,
        }}
      >
        <ReviewBody
          view={view}
          onRestart={onRestart}
          onReloadCard={onReloadCard}
          onSkipCard={onSkipCard}
          onOpenDeck={onOpenDeck}
          onChooseWorkspace={onChooseWorkspace}
        />
        {(view.kind === "complete" || view.kind === "empty") && (
          <Action label="Start New Session" keys="⌘ R" onClick={onRestart} />
        )}
        {issues.length > 0 && (
          <div style={{ ...column, gap: 8 }}>
            <text style={{ color: colors.error }}>Some decks or cards were excluded:</text>
            {issues.map((issue, index) => (
              <text key={index} style={{ color: colors.muted, fontSize: font.label }}>
                {`${issue.relativePath}: ${issue.message}`}
              </text>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewBody({
  view,
  onRestart,
  onReloadCard,
  onSkipCard,
  onOpenDeck,
  onChooseWorkspace,
}: Omit<ReviewScreenProps, "issues">) {
  switch (view.kind) {
    case "startError":
      return (
        <div style={{ ...column, gap: 12 }}>
          <text style={{ color: colors.error, fontSize: font.title }}>Could not start review</text>
          <text style={{ color: colors.muted }}>{view.error}</text>
          <Action label="Retry" keys="⌘ R" onClick={onRestart} />
          <Action label="Choose Workspace…" onClick={onChooseWorkspace} />
        </div>
      );
    case "loadingCard":
      return <text style={{ color: colors.muted }}>Loading card…</text>;
    case "cardError":
      return (
        <div style={{ ...column, gap: 12 }}>
          <text style={{ color: colors.error }}>{`Could not load this card: ${view.error}`}</text>
          <text style={{ color: colors.muted }}>{view.deckPath}</text>
          <Action label="Retry Card" keys="⌘ R" onClick={onReloadCard} />
          <Action label="Skip Card" onClick={onSkipCard} />
          <Action label="Open Deck" keys="⌘ O" onClick={onOpenDeck} />
        </div>
      );
    case "card": {
      const clozeRevealed = view.revealed && view.cardType === "cloze";
      return (
        <>
          <CardMarkdown
            testId={clozeRevealed ? "revealed-answer" : "prompt"}
            source={clozeRevealed ? view.reveal : view.prompt}
            deckPath={view.deckPath}
          />
          {view.revealed && view.cardType === "qa" && (
            <>
              <div style={{ height: 1, backgroundColor: colors.line }} />
              <CardMarkdown
                testId="revealed-answer"
                source={view.reveal}
                deckPath={view.deckPath}
              />
            </>
          )}
        </>
      );
    }
    case "loading":
    case "complete":
    case "empty":
      return (
        <div
          style={{
            ...column,
            flexGrow: 1,
            justifyContent: "center",
            alignItems: "center",
            gap: 10,
          }}
        >
          <text style={{ color: colors.text, fontSize: font.display }}>
            {view.kind === "loading"
              ? "Loading cards…"
              : view.kind === "complete"
                ? "Review complete"
                : "No cards due"}
          </text>
          <text style={{ color: colors.muted, fontSize: font.body }}>
            {view.kind === "loading"
              ? ""
              : view.kind === "complete"
                ? reviewSummary(view.grades)
                : "There are no reviewable new or due cards."}
          </text>
        </div>
      );
  }
}
