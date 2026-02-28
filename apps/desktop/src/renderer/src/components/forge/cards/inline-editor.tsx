import { useCallback, useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

type MarkdownStorage = {
  readonly markdown?: {
    readonly getMarkdown: () => string;
  };
};

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
  const lastContentFromProp = useRef(content);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const debouncedChange = useCallback((md: string) => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => onContentChangeRef.current?.(md), DEBOUNCE_MS);
  }, []);

  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: { HTMLAttributes: { class: "editor-code-block" } },
        hardBreak: false,
      }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content,
    editable,
    editorProps: {
      attributes: {
        class: cn("editor-prosemirror", className),
      },
    },
    onUpdate: ({ editor }) => {
      const storage = editor.storage as MarkdownStorage;
      const md = storage.markdown ? storage.markdown.getMarkdown() : editor.getText();
      lastContentFromProp.current = md;
      debouncedChange(md);
    },
  });

  useEffect(() => {
    if (!editor || content === lastContentFromProp.current) return;
    lastContentFromProp.current = content;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [content, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}
