import { useCallback, useEffect, useRef } from "react";
import { useEditor, type Editor, type UseEditorOptions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { MathDisplay } from "@/components/editor/extensions/math-display";
import { MathInline } from "@/components/editor/extensions/math-inline";
import { ProseMirrorMath } from "@/components/editor/extensions/prosemirror-math";
import { cn } from "@/lib/utils";

type MarkdownStorage = {
  readonly markdown?: {
    readonly getMarkdown: () => string;
  };
};

const baseExtensions: NonNullable<UseEditorOptions["extensions"]> = [
  StarterKit.configure({
    codeBlock: {
      HTMLAttributes: {
        class: "editor-code-block",
      },
    },
    hardBreak: false,
  }),
  ProseMirrorMath,
  MathInline,
  MathDisplay,
  Markdown.configure({
    html: false,
    transformCopiedText: true,
    transformPastedText: true,
  }),
];

export type UseMarkdownEditorOptions = {
  readonly content: string;
  readonly onContentChange?: ((markdown: string) => void) | undefined;
  readonly editable?: boolean | undefined;
  readonly className?: string | undefined;
  readonly debounceMs?: number | undefined;
  readonly editorOptions?: Omit<UseEditorOptions, "content" | "editable" | "onUpdate"> | undefined;
};

export const getEditorMarkdown = (editor: Editor): string => {
  const storage = editor.storage as MarkdownStorage;
  if (storage.markdown) {
    return storage.markdown.getMarkdown();
  }
  return editor.getText();
};

export function useMarkdownEditor({
  content,
  onContentChange,
  editable = true,
  className,
  debounceMs,
  editorOptions,
}: UseMarkdownEditorOptions) {
  const lastContentFromProp = useRef(content);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onContentChangeRef = useRef(onContentChange);
  const debounceMsRef = useRef(debounceMs);
  onContentChangeRef.current = onContentChange;
  debounceMsRef.current = debounceMs;

  const emitContentChange = useCallback((markdown: string) => {
    const onChange = onContentChangeRef.current;
    if (!onChange) {
      return;
    }

    clearTimeout(debounceTimer.current);

    const nextDebounceMs = debounceMsRef.current;
    if (!nextDebounceMs || nextDebounceMs <= 0) {
      onChange(markdown);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      onContentChangeRef.current?.(markdown);
    }, nextDebounceMs);
  }, []);

  useEffect(() => () => clearTimeout(debounceTimer.current), []);

  const editorAttributes = editorOptions?.editorProps?.attributes;
  const mergedAttributes =
    typeof editorAttributes === "function"
      ? (state: Parameters<typeof editorAttributes>[0]) => {
          const resolvedAttributes = editorAttributes(state);
          return {
            ...resolvedAttributes,
            class: cn("editor-prosemirror", resolvedAttributes.class, className),
          };
        }
      : {
          ...editorAttributes,
          class: cn("editor-prosemirror", editorAttributes?.class, className),
        };
  const editor = useEditor({
    ...editorOptions,
    immediatelyRender: false,
    extensions: [...baseExtensions, ...(editorOptions?.extensions ?? [])],
    content,
    editable,
    editorProps: {
      ...editorOptions?.editorProps,
      attributes: mergedAttributes,
    },
    onUpdate: ({ editor }) => {
      const markdown = getEditorMarkdown(editor);
      lastContentFromProp.current = markdown;
      emitContentChange(markdown);
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
    if (!editor) {
      return;
    }

    editor.setEditable(editable);
  }, [editable, editor]);

  return editor;
}
