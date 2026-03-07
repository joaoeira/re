import { EditorField } from "@/components/editor/editor-field";
import type { ImportDeckImageAssetFn } from "@/components/editor/hooks/use-markdown-editor";

type ClozeEditorProps = {
  readonly content: string;
  readonly frozen: boolean;
  readonly onChange: (content: string) => void;
  readonly onToggleFrozen: () => void;
  readonly rootPath?: string | null;
  readonly deckPath?: string | null;
  readonly importDeckImageAsset?: ImportDeckImageAssetFn | undefined;
};

export function ClozeEditor({
  content,
  frozen,
  onChange,
  onToggleFrozen,
  rootPath = null,
  deckPath = null,
  importDeckImageAsset,
}: ClozeEditorProps) {
  return (
    <EditorField
      label="Text"
      content={content}
      onContentChange={onChange}
      frozen={frozen}
      onToggleFreeze={onToggleFrozen}
      placeholder="Use {{c1::...}} or Cmd+Shift+C to wrap selected text."
      enableClozeShortcut
      rootPath={rootPath}
      deckPath={deckPath}
      importDeckImageAsset={importDeckImageAsset}
    />
  );
}
