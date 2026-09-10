import type { ReviewCardDraft } from "@simbyotic/re/study";
import { DraftField, type DraftFieldName, type DraftFieldState } from "../ui/field";
import { formContent, lastFieldRows, scroller } from "./create-screen";

export interface EditScreenProps {
  readonly draft: ReviewCardDraft;
  readonly field: (name: DraftFieldName) => DraftFieldState;
  readonly onChange: (name: DraftFieldName, value: string) => void;
}

export function EditScreen({ draft, field, onChange }: EditScreenProps) {
  const rows = lastFieldRows(draft.cardType, field);
  return (
    <div style={scroller}>
      <div style={formContent}>
        {draft.cardType === "qa" ? (
          <>
            <DraftField
              label="Question"
              testId="edit-question"
              value={draft.question}
              placeholder="Question"
              rows={4}
              autoFocus
              {...field("question")}
              onChange={(value) => onChange("question", value)}
            />
            <DraftField
              label="Answer"
              testId="edit-answer"
              value={draft.answer}
              placeholder="Answer"
              rows={rows}
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
            rows={rows}
            autoFocus
            {...field("content")}
            onChange={(value) => onChange("content", value)}
          />
        )}
      </div>
    </div>
  );
}
