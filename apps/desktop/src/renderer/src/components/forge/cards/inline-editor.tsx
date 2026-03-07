import { EditorContent } from "@tiptap/react";

import { useMarkdownEditor } from "@/components/editor/hooks/use-markdown-editor";

const DEBOUNCE_MS = 300;

type InlineEditorProps = {
  readonly content: string;
  readonly onContentChange?: (markdown: string) => void;
  readonly editable?: boolean;
  readonly className?: string;
};

export function InlineEditor({
  content,
  onContentChange,
  editable = true,
  className,
}: InlineEditorProps) {
  const editor = useMarkdownEditor({
    content,
    editable,
    className,
    onContentChange,
    debounceMs: DEBOUNCE_MS,
  });

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}
