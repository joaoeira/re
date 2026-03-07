import { Path } from "@effect/platform";
import { resolveDeckImagePath } from "@re/workspace";
import { useCallback, useEffect, useRef } from "react";
import { useEditor, type Editor, type UseEditorOptions } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Effect, Either } from "effect";

import { MathDisplay } from "@/components/editor/extensions/math-display";
import { MathInline } from "@/components/editor/extensions/math-inline";
import { ProseMirrorMath } from "@/components/editor/extensions/prosemirror-math";
import { createReImageExtension } from "@/components/editor/extensions/re-image";
import { cn } from "@/lib/utils";
import { toDesktopAssetUrl } from "@shared/lib/asset-url";
import type { ImageExtension } from "@shared/rpc/schemas/editor";

type MarkdownStorage = {
  readonly markdown?: {
    readonly getMarkdown: () => string;
  };
};

export type ImportDeckImageAssetFn = (input: {
  readonly deckPath: string;
  readonly extension: ImageExtension;
  readonly bytes: Uint8Array;
}) => Promise<{ readonly deckRelativePath: string }>;

type PendingImageImportRange = {
  readonly from: number;
  readonly to: number;
};

const SUPPORTED_IMAGE_EXTENSIONS = new Set<ImageExtension>([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

const MIME_TYPE_TO_EXTENSION: Record<string, ImageExtension> = {
  "image/png": ".png",
  "image/jpeg": ".jpeg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const toEditorMarkdownImageLabel = (src: string): string => {
  const normalized = src.trim();
  if (normalized.length === 0) {
    return "Unresolved image";
  }
  const segments = normalized.split(/[/\\]/);
  return segments[segments.length - 1] || "Unresolved image";
};

const resolveEditorDisplayUrl = (
  rootPath: string | null,
  deckPath: string | null,
  imagePath: string,
): string | null => {
  if (!rootPath || !deckPath) {
    return null;
  }

  const result = Effect.gen(function* () {
    const resolved = yield* resolveDeckImagePath({
      rootPath,
      deckPath,
      imagePath,
    });
    return toDesktopAssetUrl(resolved.workspaceRelativePath);
  }).pipe(Effect.either, Effect.provide(Path.layer), Effect.runSync);

  return Either.isRight(result) ? result.right : null;
};

const toImageExtension = (file: File): ImageExtension | null => {
  const fromMime = MIME_TYPE_TO_EXTENSION[file.type];
  if (fromMime) {
    return fromMime;
  }

  const fileName = file.name.toLowerCase();
  for (const extension of SUPPORTED_IMAGE_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return extension;
    }
  }

  return null;
};

const createBaseExtensions = (reImageExtension: ReturnType<typeof createReImageExtension>) =>
  [
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
    reImageExtension,
    Markdown.configure({
      html: false,
      transformCopiedText: true,
      transformPastedText: true,
    }),
  ] satisfies NonNullable<UseEditorOptions["extensions"]>;

export type UseMarkdownEditorOptions = {
  readonly content: string;
  readonly onContentChange?: ((markdown: string) => void) | undefined;
  readonly editable?: boolean | undefined;
  readonly className?: string | undefined;
  readonly debounceMs?: number | undefined;
  readonly rootPath?: string | null | undefined;
  readonly deckPath?: string | null | undefined;
  readonly importDeckImageAsset?: ImportDeckImageAssetFn | undefined;
  readonly onImageImportError?: ((message: string) => void) | undefined;
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
  rootPath = null,
  deckPath = null,
  importDeckImageAsset,
  onImageImportError,
  editorOptions,
}: UseMarkdownEditorOptions) {
  const lastContentFromProp = useRef(content);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onContentChangeRef = useRef(onContentChange);
  const debounceMsRef = useRef(debounceMs);
  const rootPathRef = useRef<string | null>(rootPath);
  const deckPathRef = useRef<string | null>(deckPath);
  const importDeckImageAssetRef = useRef(importDeckImageAsset);
  const onImageImportErrorRef = useRef(onImageImportError);
  const editorRef = useRef<Editor | null>(null);
  const pendingImageImportsRef = useRef(new Map<object, PendingImageImportRange>());

  onContentChangeRef.current = onContentChange;
  debounceMsRef.current = debounceMs;
  rootPathRef.current = rootPath;
  deckPathRef.current = deckPath;
  importDeckImageAssetRef.current = importDeckImageAsset;
  onImageImportErrorRef.current = onImageImportError;

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

  const reImageExtensionRef = useRef(
    createReImageExtension({
      resolveDisplayUrl: (src) =>
        resolveEditorDisplayUrl(rootPathRef.current, deckPathRef.current, src),
      getPlaceholderLabel: toEditorMarkdownImageLabel,
    }),
  );
  const baseExtensionsRef = useRef(createBaseExtensions(reImageExtensionRef.current));

  const importImageFile = useCallback(async (editor: Editor, file: File): Promise<void> => {
    const extension = toImageExtension(file);
    if (!extension) {
      onImageImportErrorRef.current?.(`Unsupported image type: ${file.type || file.name}`);
      return;
    }

    const currentDeckPath = deckPathRef.current;
    const importImage = importDeckImageAssetRef.current;
    if (!currentDeckPath || !importImage) {
      onImageImportErrorRef.current?.("Choose a deck before pasting or dropping images.");
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const importId = {};
    const selection = editor.state.selection;
    pendingImageImportsRef.current.set(importId, {
      from: selection.from,
      to: selection.to,
    });

    try {
      const imported = await importImage({
        deckPath: currentDeckPath,
        extension,
        bytes,
      });

      const mappedRange = pendingImageImportsRef.current.get(importId);
      pendingImageImportsRef.current.delete(importId);
      if (mappedRange === undefined || editor.isDestroyed) {
        return;
      }

      const imageNode = editor.state.schema.nodes.image;
      if (!imageNode) {
        throw new Error("Image node is not registered in the editor schema.");
      }

      const inserted = editor
        .chain()
        .focus()
        .insertContentAt(
          {
            from: mappedRange.from,
            to: mappedRange.to,
          },
          {
            type: "image",
            attrs: {
              src: imported.deckRelativePath,
              alt: "",
              title: null,
            },
          },
        )
        .run();

      if (!inserted) {
        throw new Error("Unable to insert image at the current editor position.");
      }
    } catch (error) {
      pendingImageImportsRef.current.delete(importId);
      onImageImportErrorRef.current?.(
        error instanceof Error ? error.message : "Failed to import image.",
      );
    }
  }, []);

  const handleImagePaste = useCallback(
    (_view: EditorView, event: ClipboardEvent): boolean => {
      const items = event.clipboardData?.items;
      if (!items) {
        return false;
      }

      const imageItem = Array.from(items).find(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      const file = imageItem?.getAsFile();
      if (!file) {
        return false;
      }

      event.preventDefault();
      if (editorRef.current) {
        void importImageFile(editorRef.current, file);
      }
      return true;
    },
    [importImageFile],
  );

  const handleImageDrop = useCallback(
    (view: EditorView, event: DragEvent): boolean => {
      const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) =>
        candidate.type.startsWith("image/"),
      );
      if (!file) {
        return false;
      }

      event.preventDefault();
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (position) {
        view.dispatch(
          view.state.tr.setSelection(TextSelection.create(view.state.doc, position.pos)),
        );
      }
      if (editorRef.current) {
        void importImageFile(editorRef.current, file);
      }
      return true;
    },
    [importImageFile],
  );

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
    extensions: [...baseExtensionsRef.current, ...(editorOptions?.extensions ?? [])],
    content,
    editable,
    editorProps: {
      ...editorOptions?.editorProps,
      attributes: mergedAttributes,
      handlePaste: (view, event) =>
        handleImagePaste(view, event) ||
        ((
          editorOptions?.editorProps?.handlePaste as
            | ((view: EditorView, event: ClipboardEvent) => boolean)
            | undefined
        )?.(view, event) ??
          false),
      handleDrop: (view, event, _slice, moved) =>
        (!moved && handleImageDrop(view, event)) ||
        ((
          editorOptions?.editorProps?.handleDrop as
            | ((view: EditorView, event: DragEvent, slice: unknown, moved: boolean) => boolean)
            | undefined
        )?.(view, event, _slice, moved) ??
          false) ||
        false,
    },
    onUpdate: ({ editor }) => {
      const markdown = getEditorMarkdown(editor);
      lastContentFromProp.current = markdown;
      emitContentChange(markdown);
    },
  });

  editorRef.current = editor;

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

  useEffect(() => {
    if (!editor) {
      return;
    }

    const remapPendingImageImports = (event: {
      readonly transaction: { readonly mapping: { map: (position: number) => number } };
    }) => {
      if (pendingImageImportsRef.current.size === 0) {
        return;
      }

      const mapping = event.transaction.mapping as unknown as {
        readonly mapResult: (
          position: number,
          assoc?: number,
        ) => { readonly pos: number; readonly deleted: boolean };
      };

      const nextPendingImports = new Map<object, PendingImageImportRange>();
      for (const [id, range] of pendingImageImportsRef.current.entries()) {
        const mappedFrom = mapping.mapResult(range.from, -1);
        const mappedTo = mapping.mapResult(range.to, 1);

        if (mappedFrom.deleted || mappedTo.deleted) {
          continue;
        }

        nextPendingImports.set(id, {
          from: mappedFrom.pos,
          to: mappedTo.pos,
        });
      }

      pendingImageImportsRef.current = nextPendingImports;
    };

    editor.on("transaction", remapPendingImageImports);
    return () => {
      editor.off("transaction", remapPendingImageImports);
    };
  }, [editor]);

  return editor;
}
