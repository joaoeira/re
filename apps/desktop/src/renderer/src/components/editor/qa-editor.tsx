import { Braces } from "lucide-react";

import { EditorField } from "@/components/editor/editor-field";
import type { ImportDeckImageAssetFn } from "@/components/editor/hooks/use-markdown-editor";

type QaEditorProps = {
  readonly frontContent: string;
  readonly backContent: string;
  readonly frontFrozen: boolean;
  readonly backFrozen: boolean;
  readonly onFrontChange: (content: string) => void;
  readonly onBackChange: (content: string) => void;
  readonly onToggleFrontFrozen: () => void;
  readonly onToggleBackFrozen: () => void;
  readonly rootPath?: string | null;
  readonly deckPath?: string | null;
  readonly importDeckImageAsset?: ImportDeckImageAssetFn | undefined;
};

export function QaEditor({
  frontContent,
  backContent,
  frontFrozen,
  backFrozen,
  onFrontChange,
  onBackChange,
  onToggleFrontFrozen,
  onToggleBackFrozen,
  rootPath = null,
  deckPath = null,
  importDeckImageAsset,
}: QaEditorProps) {
  const showClozeHint = frontContent.trim().length > 0 && backContent.trim().length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <EditorField
        label="Front"
        content={frontContent}
        onContentChange={onFrontChange}
        frozen={frontFrozen}
        onToggleFreeze={onToggleFrontFrozen}
        placeholder="Question..."
        enableClozeShortcut
        rootPath={rootPath}
        deckPath={deckPath}
        importDeckImageAsset={importDeckImageAsset}
      />
      <div className="h-px bg-border" />
      <EditorField
        label="Back"
        content={backContent}
        onContentChange={onBackChange}
        frozen={backFrozen}
        onToggleFreeze={onToggleBackFrozen}
        placeholder="Answer..."
        rootPath={rootPath}
        deckPath={deckPath}
        importDeckImageAsset={importDeckImageAsset}
      />
      {showClozeHint && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
          <Braces className="size-2.5" />
          <span>
            Select text and press{" "}
            <kbd className="border border-border px-0.5 text-muted-foreground/60">⌘⇧C</kbd> to
            create a cloze deletion
          </span>
        </div>
      )}
    </div>
  );
}
