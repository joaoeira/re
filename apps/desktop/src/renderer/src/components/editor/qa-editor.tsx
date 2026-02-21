import { EditorField } from "@/components/editor/editor-field";

type QaEditorProps = {
  readonly frontContent: string;
  readonly backContent: string;
  readonly frontFrozen: boolean;
  readonly backFrozen: boolean;
  readonly onFrontChange: (content: string) => void;
  readonly onBackChange: (content: string) => void;
  readonly onToggleFrontFrozen: () => void;
  readonly onToggleBackFrozen: () => void;
};

export function QaEditor({
  frontContent,
  backContent,
  frontFrozen,
  backFrozen,
  onFrontChange,
  onBackChange,
  onToggleFrontFrozen,
  onToggleBackFrozen,
}: QaEditorProps) {
  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
      <EditorField
        label="Front"
        content={frontContent}
        onContentChange={onFrontChange}
        frozen={frontFrozen}
        onToggleFreeze={onToggleFrontFrozen}
        placeholder="Question..."
      />
      <EditorField
        label="Back"
        content={backContent}
        onContentChange={onBackChange}
        frozen={backFrozen}
        onToggleFreeze={onToggleBackFrozen}
        placeholder="Answer..."
      />
    </div>
  );
}
