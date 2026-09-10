import { colors, column } from "../theme";
import { DeckCombobox, type DeckComboboxProps } from "../ui/deck-combobox";
import { Dropdown } from "../ui/dropdown";
import { DraftField, Field, type DraftFieldName, type DraftFieldState } from "../ui/field";

export interface CreateScreenProps {
  readonly editorKey: number;
  readonly cardType: "qa" | "cloze";
  readonly deck: DeckComboboxProps & { readonly error?: string };
  readonly type: {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly onChange: (value: string) => void;
  };
  readonly draft: {
    readonly question: string;
    readonly answer: string;
    readonly content: string;
  };
  readonly initialFocus: DraftFieldName;
  readonly field: (name: DraftFieldName) => DraftFieldState;
  readonly onChange: (name: DraftFieldName, value: string) => void;
}

export function CreateScreen({
  editorKey,
  cardType,
  deck,
  type,
  draft,
  initialFocus,
  field,
  onChange,
}: CreateScreenProps) {
  const { error: deckError, ...deckCombobox } = deck;
  return (
    <div
      key={editorKey}
      style={{
        ...column,
        minHeight: 0,
        overflowY: "scroll",
        flexGrow: 1,
        paddingLeft: 70,
        paddingRight: 70,
        paddingTop: 9,
        gap: 17,
      }}
    >
      <Field label="Deck" error={deckError}>
        <DeckCombobox {...deckCombobox} />
      </Field>
      <Field label="Card Type">
        <Dropdown
          testId="type-select"
          value={cardType}
          open={type.open}
          onOpenChange={type.onOpenChange}
          options={[
            { value: "qa", label: "Question and Answer" },
            { value: "cloze", label: "Cloze" },
          ]}
          onChange={type.onChange}
        />
      </Field>
      <div style={{ height: 1, backgroundColor: colors.line }} />
      {cardType === "qa" ? (
        <>
          <DraftField
            label="Question"
            testId="question"
            autoFocus={initialFocus !== "answer"}
            value={draft.question}
            onChange={(value) => onChange("question", value)}
            placeholder="What do you want to remember?"
            rows={2}
            {...field("question")}
          />
          <DraftField
            label="Answer"
            testId="answer"
            autoFocus={initialFocus === "answer"}
            value={draft.answer}
            onChange={(value) => onChange("answer", value)}
            placeholder="The answer"
            rows={2}
            {...field("answer")}
          />
        </>
      ) : (
        <DraftField
          label="Content"
          testId="cloze-content"
          autoFocus
          value={draft.content}
          onChange={(value) => onChange("content", value)}
          placeholder="The {{c1::answer}} in context."
          rows={5}
          {...field("content")}
        />
      )}
    </div>
  );
}
