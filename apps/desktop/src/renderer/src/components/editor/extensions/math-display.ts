import { Node, mergeAttributes } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { TagParseRule } from "@tiptap/pm/model";
import { defaultBlockMathParseRules } from "@benrbray/prosemirror-math";
import type { MarkdownSerializerState } from "prosemirror-markdown";

const parseRules: TagParseRule[] = [{ tag: "math-display" }, ...defaultBlockMathParseRules];

export const MathDisplay = Node.create({
  name: "math_display",
  group: "block math",
  content: "text*",
  atom: true,
  code: true,

  parseHTML() {
    return parseRules;
  },

  renderHTML({ HTMLAttributes }) {
    return ["math-display", mergeAttributes({ class: "math-node" }, HTMLAttributes), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write("$$\n");
          state.text(node.textContent, false);
          state.ensureNewLine();
          state.write("$$");
          state.closeBlock(node);
        },
      },
    };
  },
});
