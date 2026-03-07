import { Node, mergeAttributes } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { TagParseRule } from "@tiptap/pm/model";
import { defaultInlineMathParseRules } from "@benrbray/prosemirror-math";
import type { MarkdownSerializerState } from "prosemirror-markdown";

const parseRules: TagParseRule[] = [{ tag: "math-inline" }, ...defaultInlineMathParseRules];

export const MathInline = Node.create({
  name: "math_inline",
  group: "inline math",
  content: "text*",
  inline: true,
  atom: true,
  code: true,

  parseHTML() {
    return parseRules;
  },

  renderHTML({ HTMLAttributes }) {
    return ["math-inline", mergeAttributes({ class: "math-node" }, HTMLAttributes), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          state.write("$");
          state.text(node.textContent, false);
          state.write("$");
        },
      },
    };
  },
});
