import { EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { Pin } from "lucide-react";
import { useRef } from "react";

import { createClozeShortcutExtension } from "@/components/editor/extensions/cloze-shortcut";
import {
  type ImportDeckImageAssetFn,
  useMarkdownEditor,
} from "@/components/editor/hooks/use-markdown-editor";
import { cn } from "@/lib/utils";

type EditorFieldProps = {
  readonly label: string;
  readonly frozen: boolean;
  readonly onToggleFreeze: () => void;
  readonly content: string;
  readonly onContentChange: (markdown: string) => void;
  readonly placeholder?: string;
  readonly enableClozeShortcut?: boolean;
  readonly rootPath?: string | null;
  readonly deckPath?: string | null;
  readonly importDeckImageAsset?: ImportDeckImageAssetFn | undefined;
};

export function EditorField({
  label,
  frozen,
  onToggleFreeze,
  content,
  onContentChange,
  placeholder,
  enableClozeShortcut = false,
  rootPath = null,
  deckPath = null,
  importDeckImageAsset,
}: EditorFieldProps) {
  const clozeShortcutExtensionRef = useRef(
    enableClozeShortcut ? createClozeShortcutExtension() : null,
  );

  const editor = useMarkdownEditor({
    content,
    onContentChange,
    rootPath,
    deckPath,
    importDeckImageAsset,
    editorOptions: {
      extensions: [
        Placeholder.configure({
          placeholder: placeholder ?? "",
        }),
        ...(clozeShortcutExtensionRef.current ? [clozeShortcutExtensionRef.current] : []),
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
