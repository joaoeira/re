import { Extension } from "@tiptap/react";
import { nextClozeDeletionIndex } from "@re/core";

import { getEditorMarkdown } from "../hooks/use-markdown-editor";

export const createClozeShortcutExtension = () =>
  Extension.create({
    name: "clozeShortcut",
    addKeyboardShortcuts() {
      return {
        "Mod-Shift-c": () => {
          const { editor } = this;
          const { empty, from, to } = editor.state.selection;

          if (empty) {
            return false;
          }

          const nextClozeIndex = nextClozeDeletionIndex(getEditorMarkdown(editor));
          const selectedText = editor.state.doc.textBetween(from, to, "\n", "\n");

          return editor
            .chain()
            .focus()
            .insertContentAt({ from, to }, `{{c${nextClozeIndex}::${selectedText}}}`)
            .run();
        },
      };
    },
  });
