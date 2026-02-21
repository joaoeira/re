import { EditorField } from "@/components/editor/editor-field";

type ClozeEditorProps = {
  readonly content: string;
  readonly frozen: boolean;
  readonly onChange: (content: string) => void;
  readonly onToggleFrozen: () => void;
};

export function ClozeEditor({ content, frozen, onChange, onToggleFrozen }: ClozeEditorProps) {
  return (
    <EditorField
      label="Cloze"
      content={content}
      onContentChange={onChange}
      frozen={frozen}
      onToggleFreeze={onToggleFrozen}
      placeholder="Use {{c1::...}} or Cmd+Shift+C to wrap selected text."
      enableClozeShortcut
    />
  );
}
