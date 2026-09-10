import type { ReviewCardDraft } from "@simbyotic/re/study";
import { colors, column, font } from "../theme";
import { Action } from "../ui/action";
import { DraftField, type DraftFieldName, type DraftFieldState } from "../ui/field";

export interface EditScreenProps {
  readonly draft: ReviewCardDraft;
  readonly field: (name: DraftFieldName) => DraftFieldState;
  readonly onChange: (name: DraftFieldName, value: string) => void;
  readonly onDiscard: () => void;
}

export function EditScreen({ draft, field, onChange, onDiscard }: EditScreenProps) {
  return (
    <div
      style={{
        ...column,
        flexGrow: 1,
        minHeight: 0,
        overflowY: "scroll",
        padding: 30,
        gap: 16,
      }}
    >
      <text style={{ color: colors.text, fontSize: font.title }}>
        {`Edit ${draft.cardType === "cloze" ? "Cloze Note" : "Card"}`}
      </text>
      {draft.cardType === "qa" ? (
        <>
          <DraftField
            label="Question"
            testId="edit-question"
            value={draft.question}
            placeholder="Question"
            rows={3}
            autoFocus
            {...field("question")}
            onChange={(value) => onChange("question", value)}
          />
          <DraftField
            label="Answer"
            testId="edit-answer"
            value={draft.answer}
            placeholder="Answer"
            rows={3}
            {...field("answer")}
            onChange={(value) => onChange("answer", value)}
          />
        </>
      ) : (
        <DraftField
          label="Content"
          testId="edit-content"
          value={draft.content}
          placeholder="Cloze note"
          rows={6}
          autoFocus
          {...field("content")}
          onChange={(value) => onChange("content", value)}
        />
      )}
      <Action label="Discard Changes" keys="Esc" onClick={onDiscard} />
    </div>
  );
}
