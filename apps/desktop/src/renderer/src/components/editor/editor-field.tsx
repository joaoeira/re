import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
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
  const lastContentFromProp = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: "editor-code-block",
          },
        },
        hardBreak: false,
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "",
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
      const md = getMarkdown(editor);
      lastContentFromProp.current = md;
      onContentChange(md);
    },
  });

  useEffect(() => {
    if (!editor || content === lastContentFromProp.current) {
      return;
    }
    lastContentFromProp.current = content;
    editor.commands.setContent(content, { emitUpdate: false });
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
    <div className="group/field flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40">
          {label}
        </span>
        <button
          type="button"
          onClick={onToggleFreeze}
          className={cn(
            "flex items-center transition-opacity",
            frozen
              ? "text-foreground opacity-100"
              : "text-muted-foreground opacity-0 group-hover/field:opacity-60",
          )}
        >
          <Pin className={cn("size-2.5", frozen ? "fill-current" : "")} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="text-sm text-muted-foreground">{placeholder ?? "Loading editor..."}</div>
        )}
      </div>
    </div>
  );
}
