import { Node, mergeAttributes } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownSerializerState } from "prosemirror-markdown";

type ReImageOptions = {
  readonly resolveDisplayUrl: (src: string) => string | null;
  readonly getPlaceholderLabel: (src: string) => string;
};

const escapeMarkdownImageAlt = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");

const escapeMarkdownImageTitle = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const serializeImageMarkdown = (state: MarkdownSerializerState, node: ProseMirrorNode): void => {
  const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";

  const escapedAlt = escapeMarkdownImageAlt(alt);
  const titlePart = title.length > 0 ? ` "${escapeMarkdownImageTitle(title)}"` : "";
  state.write(`![${escapedAlt}](${src}${titlePart})`);
};

const createImageNodeView =
  (options: ReImageOptions) =>
  ({ node }: { node: ProseMirrorNode }) => {
    const dom = document.createElement("span");
    dom.className = "editor-image-node";
    dom.contentEditable = "false";

    const render = () => {
      const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
      const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
      const resolvedUrl = options.resolveDisplayUrl(src);

      dom.replaceChildren();

      if (resolvedUrl) {
        const image = document.createElement("img");
        image.className = "editor-image-preview";
        image.src = resolvedUrl;
        image.alt = alt;
        if (title.length > 0) {
          image.title = title;
        }
        image.addEventListener(
          "error",
          () => {
            dom.replaceChildren();
            const placeholder = document.createElement("span");
            placeholder.className = "editor-image-placeholder";
            placeholder.textContent = options.getPlaceholderLabel(src);
            dom.appendChild(placeholder);
          },
          { once: true },
        );
        dom.appendChild(image);
        return;
      }

      const placeholder = document.createElement("span");
      placeholder.className = "editor-image-placeholder";
      placeholder.textContent = options.getPlaceholderLabel(src);
      dom.appendChild(placeholder);
    };

    render();

    return {
      dom,
      update: (updatedNode: ProseMirrorNode) => {
        if (updatedNode.type.name !== node.type.name) {
          return false;
        }
        node = updatedNode;
        render();
        return true;
      },
      ignoreMutation: () => true,
    };
  };

export const createReImageExtension = (options: ReImageOptions) =>
  Node.create<ReImageOptions>({
    name: "image",
    inline: true,
    group: "inline",
    draggable: true,
    selectable: true,
    atom: true,

    addOptions() {
      return options;
    },

    addAttributes() {
      return {
        src: {
          default: "",
        },
        alt: {
          default: "",
        },
        title: {
          default: null,
        },
      };
    },

    parseHTML() {
      return [{ tag: "img[src]" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["img", mergeAttributes(HTMLAttributes)];
    },

    addNodeView() {
      return createImageNodeView(this.options);
    },

    addStorage() {
      return {
        markdown: {
          serialize: serializeImageMarkdown,
        },
      };
    },
  });
