import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Pin } from "lucide-react";
import { Markdown } from "tiptap-markdown";

import { cn } from "@/lib/utils";

type EditorFieldProps = {
  readonly label: string;
  readonly frozen: boolean;
  readonly onToggleFreeze: () => void;
  readonly content: string;
  readonly onContentChange: (markdown: string) => void;
  readonly placeholder?: string;
  readonly enableClozeShortcut?: boolean;
};

type MarkdownStorage = {
  readonly markdown?: {
    readonly getMarkdown: () => string;
  };
};

const getMarkdown = (editor: NonNullable<ReturnType<typeof useEditor>>): string => {
  const storage = editor.storage as MarkdownStorage;
  if (storage.markdown) {
    return storage.markdown.getMarkdown();
  }
  return editor.getText();
};

const getNextClozeIndex = (markdown: string): number => {
  const pattern = /\{\{c(\d+)::/g;
  let max = 0;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(markdown)) !== null) {
    const index = Number.parseInt(match[1]!, 10);
    if (Number.isFinite(index)) {
      max = Math.max(max, index);
    }
  }

  return max + 1;
};

export function EditorField({
  label,
  frozen,
  onToggleFreeze,
  content,
  onContentChange,
  placeholder,
  enableClozeShortcut = false,
}: EditorFieldProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: "editor-code-block",
          },
        },
      }),
      Markdown.configure({
        html: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    content,
    editorProps: {
      attributes: {
        class: "editor-prosemirror",
      },
    },
    onUpdate: ({ editor }) => {
      onContentChange(getMarkdown(editor));
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const editorMarkdown = getMarkdown(editor);
    if (editorMarkdown !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  useEffect(() => {
    if (!editor || !enableClozeShortcut) {
      return;
    }

    const keyDownHandler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "c") {
        return;
      }

      const { empty, from, to } = editor.state.selection;
      if (empty) {
        return;
      }

      event.preventDefault();

      const nextClozeIndex = getNextClozeIndex(getMarkdown(editor));
      const selectedText = editor.state.doc.textBetween(from, to, "\n", "\n");
      editor
        .chain()
        .focus()
        .insertContentAt({ from, to }, `{{c${nextClozeIndex}::${selectedText}}}`)
        .run();
    };

    const domNode = editor.view.dom;
    domNode.addEventListener("keydown", keyDownHandler);

    return () => {
      domNode.removeEventListener("keydown", keyDownHandler);
    };
  }, [editor, enableClozeShortcut]);

  return (
    <div className="flex min-h-0 flex-1 flex-col border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
        <span className="uppercase tracking-widest text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={onToggleFreeze}
          className={cn(
            "flex items-center gap-1 border px-2 py-0.5 text-[11px] transition-colors",
            frozen
              ? "border-foreground text-foreground"
              : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
          )}
        >
          <Pin className={cn("size-3", frozen ? "fill-current" : "")} />
          <span>{frozen ? "Pinned" : "Pin"}</span>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="text-sm text-muted-foreground">{placeholder ?? "Loading editor..."}</div>
        )}
      </div>
    </div>
  );
}
