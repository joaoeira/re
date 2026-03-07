import { EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { Pin } from "lucide-react";

import { clozeShortcutExtension } from "@/components/editor/extensions/cloze-shortcut";
import { useMarkdownEditor } from "@/components/editor/hooks/use-markdown-editor";
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

export function EditorField({
  label,
  frozen,
  onToggleFreeze,
  content,
  onContentChange,
  placeholder,
  enableClozeShortcut = false,
}: EditorFieldProps) {
  const editor = useMarkdownEditor({
    content,
    onContentChange,
    editorOptions: {
      extensions: [
        Placeholder.configure({
          placeholder: placeholder ?? "",
        }),
        ...(enableClozeShortcut ? [clozeShortcutExtension] : []),
      ],
    },
  });

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
      <div className="flex-1 overflow-auto ">
        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          <div className="text-sm text-muted-foreground">{placeholder ?? "Loading editor..."}</div>
        )}
      </div>
    </div>
  );
}
