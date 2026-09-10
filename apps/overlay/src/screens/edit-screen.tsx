import type { ReviewCardDraft } from "@simbyotic/re/study";
import { DraftField, type DraftFieldName, type DraftFieldState } from "../ui/field";
import { formBody } from "./create-screen";

export interface EditScreenProps {
  readonly draft: ReviewCardDraft;
  readonly field: (name: DraftFieldName) => DraftFieldState;
  readonly onChange: (name: DraftFieldName, value: string) => void;
}

export function EditScreen({ draft, field, onChange }: EditScreenProps) {
  return (
    <div style={formBody}>
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
            rows={5}
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
          rows={11}
          autoFocus
          {...field("content")}
          onChange={(value) => onChange("content", value)}
        />
      )}
    </div>
  );
}
