import { Action, ActionPanel, Form, Icon, Toast, showToast, useNavigation } from "@raycast/api";
import { useCallback, useRef, useState } from "react";

import { saveReviewEditForUi } from "./review";
import type { ReviewCardDraft, ReviewCardReference } from "./review-store";
import { runRaycastEffect } from "./runtime";

type EditField = "question" | "answer" | "content";

export function ReviewCardEditor({
  reference,
  draft,
  onSaved,
}: {
  readonly reference: ReviewCardReference;
  readonly draft: ReviewCardDraft;
  readonly onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const [question, setQuestion] = useState(draft.cardType === "qa" ? draft.question : "");
  const [answer, setAnswer] = useState(draft.cardType === "qa" ? draft.answer : "");
  const [content, setContent] = useState(draft.cardType === "cloze" ? draft.content : "");
  const [errors, setErrors] = useState<Partial<Record<EditField, string>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = useRef(false);

  const clearError = useCallback((field: EditField) => {
    setErrors((current) => {
      if (current[field] === undefined) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (saveInFlight.current) return;

    saveInFlight.current = true;
    setIsSaving(true);
    setErrors({});

    try {
      const editedDraft: ReviewCardDraft =
        draft.cardType === "qa"
          ? { cardType: "qa", question, answer }
          : { cardType: "cloze", content };
      const result = await runRaycastEffect(saveReviewEditForUi(reference, editedDraft));

      if (result._tag === "ReviewEditFieldError") {
        setErrors({ [result.field]: result.message });
        await showToast({
          style: Toast.Style.Failure,
          title: "Check the card",
          message: result.message,
        });
        return;
      }

      if (result._tag === "ReviewEditSaveError") {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not save the card",
          message: result.message,
        });
        return;
      }

      await showToast({ style: Toast.Style.Success, title: "Card updated" });
      onSaved();
      pop();
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  }, [answer, content, draft.cardType, onSaved, pop, question, reference]);

  return (
    <Form
      navigationTitle={`Edit ${draft.cardType === "cloze" ? "Cloze Note" : "Card"}`}
      isLoading={isSaving}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Changes"
            icon={Icon.Checkmark}
            shortcut={{ modifiers: ["cmd"], key: "enter" }}
            onSubmit={() => void save()}
          />
          <Action title="Discard Changes" icon={Icon.XMarkCircle} onAction={pop} />
        </ActionPanel>
      }
    >
      {draft.cardType === "qa" ? (
        <>
          <Form.TextArea
            id="question"
            title="Question"
            enableMarkdown
            autoFocus
            value={question}
            {...(errors.question === undefined ? {} : { error: errors.question })}
            onChange={(value) => {
              setQuestion(value);
              clearError("question");
            }}
          />
          <Form.TextArea
            id="answer"
            title="Answer"
            enableMarkdown
            value={answer}
            {...(errors.answer === undefined ? {} : { error: errors.answer })}
            onChange={(value) => {
              setAnswer(value);
              clearError("answer");
            }}
          />
        </>
      ) : (
        <Form.TextArea
          id="content"
          title="Cloze Note"
          enableMarkdown
          autoFocus
          value={content}
          {...(errors.content === undefined ? {} : { error: errors.content })}
          onChange={(value) => {
            setContent(value);
            clearError("content");
          }}
        />
      )}
    </Form>
  );
}
