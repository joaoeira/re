import { colors, column, layout, row, type } from "../theme";
import { Action } from "../ui/action";
import { DeckCombobox, type DeckComboboxProps } from "../ui/deck-combobox";
import { Dropdown } from "../ui/dropdown";
import { DraftField, type DraftFieldName, type DraftFieldState } from "../ui/field";

export const formBody = {
  ...column,
  flexGrow: 1,
  minHeight: 0,
  overflowY: "scroll",
  paddingLeft: layout.contentLeft,
  paddingRight: layout.contentRight,
  paddingTop: layout.formTop,
  paddingBottom: 12,
  gap: 23,
} as const;

export interface CreateSelectorsProps {
  readonly cardType: "qa" | "cloze";
  readonly deck: DeckComboboxProps;
  readonly type: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly onChange: (value: string) => void;
  };
}

export function CreateSelectors({ cardType, deck, type }: CreateSelectorsProps) {
  return (
    <div style={{ ...row, gap: 11, minWidth: 0 }}>
      <DeckCombobox {...deck} />
      <Dropdown
        testId="type-select"
        value={cardType}
        open={type.open}
        onOpenChange={type.onOpenChange}
        options={[
          { value: "qa", label: "Question and Answer" },
          { value: "cloze", label: "Cloze" },
        ]}
        triggerLabel={(value) => (value === "cloze" ? "Cloze" : "Q&A")}
        onChange={type.onChange}
      />
    </div>
  );
}

export interface CreateScreenProps {
  readonly editorKey: number;
  readonly cardType: "qa" | "cloze";
  readonly draft: {
    readonly question: string;
    readonly answer: string;
    readonly content: string;
  };
  readonly deckError?: string;
  readonly initialFocus: DraftFieldName;
  readonly field: (name: DraftFieldName) => DraftFieldState;
  readonly onChange: (name: DraftFieldName, value: string) => void;
  readonly onInsertCloze: () => void;
}

export function CreateScreen({
  editorKey,
  cardType,
  draft,
  deckError,
  initialFocus,
  field,
  onChange,
  onInsertCloze,
}: CreateScreenProps) {
  return (
    <div key={editorKey} style={formBody}>
      {cardType === "qa" ? (
        <>
          <DraftField
            label="Question"
            testId="question"
            autoFocus={initialFocus !== "answer"}
            value={draft.question}
            onChange={(value) => onChange("question", value)}
            placeholder="What do you want to remember?"
            rows={4}
            {...field("question")}
          />
          <DraftField
            label="Answer"
            testId="answer"
            autoFocus={initialFocus === "answer"}
            value={draft.answer}
            onChange={(value) => onChange("answer", value)}
            placeholder="The answer"
            rows={5}
            {...field("answer")}
          />
        </>
      ) : (
        <>
          <DraftField
            label="Content"
            testId="cloze-content"
            autoFocus
            value={draft.content}
            onChange={(value) => onChange("content", value)}
            placeholder="The {{c1::answer}} in context."
            rows={11}
            {...field("content")}
          />
          <div style={{ ...row, marginLeft: -6, marginTop: -7 }}>
            <Action label="Insert cloze" keys="⌘ ⇧ C" onClick={onInsertCloze} />
          </div>
        </>
      )}
      {deckError && <DeckError message={deckError} />}
    </div>
  );
}

function DeckError({ message }: { readonly message: string }) {
  return <text style={{ ...type.label, color: colors.error }}>{message}</text>;
}
