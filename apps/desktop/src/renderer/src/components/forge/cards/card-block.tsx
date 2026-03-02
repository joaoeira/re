import { useEffect, useState } from "react";
import { Check, ListTree, Braces, Trash2, Plus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ForgeGeneratedCard } from "@shared/rpc/schemas/forge";

import { ClozePanel } from "./cloze-panel";
import { InlineEditor } from "./inline-editor";
import { PermutationsPanel } from "./permutations-panel";

type CardBlockProps = {
  readonly card: ForgeGeneratedCard;
  readonly isAdded: boolean;
  readonly isAdding: boolean;
  readonly addDisabled: boolean;
  readonly expandedPanel: "permutations" | "cloze" | null;
  readonly onAdd: () => void;
  readonly onDelete: () => void;
  readonly onTogglePermutations: () => void;
  readonly onToggleCloze: () => void;
  readonly onEditQuestion: (value: string) => void;
  readonly onEditAnswer: (value: string) => void;
};

export function CardBlock({
  card,
  isAdded,
  isAdding,
  addDisabled,
  expandedPanel,
  onAdd,
  onDelete,
  onTogglePermutations,
  onToggleCloze,
  onEditQuestion,
  onEditAnswer,
}: CardBlockProps) {
  const showPermutations = expandedPanel === "permutations";
  const showCloze = expandedPanel === "cloze";
  const hasExpanded = expandedPanel !== null;

  const [permutationsMounted, setPermutationsMounted] = useState(false);
  const [clozeMounted, setClozeMounted] = useState(false);

  useEffect(() => {
    if (showPermutations) setPermutationsMounted(true);
  }, [showPermutations]);

  useEffect(() => {
    if (showCloze) setClozeMounted(true);
  }, [showCloze]);

  return (
    <div className="group relative border-b border-border/30 px-2 py-5">
      <div className={cn("transition-opacity", isAdded && "opacity-40")}>
        {isAdded && (
          <div className="mb-3 flex items-center gap-1.5 text-[11px] text-primary">
            <Check className="size-3" />
            Added to deck
          </div>
        )}

        <InlineEditor
          content={card.question}
          onContentChange={onEditQuestion}
          editable={!isAdded}
          className="min-h-0 text-[15px] font-medium leading-relaxed"
        />

        <InlineEditor
          content={card.answer}
          onContentChange={onEditAnswer}
          editable={!isAdded}
          className="mt-1.5 min-h-0 text-sm leading-relaxed text-muted-foreground"
        />
      </div>

      <div
        className={cn(
          "mt-3 flex items-center gap-1.5 transition-all",
          hasExpanded
            ? "opacity-100"
            : "translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
        )}
      >
        <>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="gap-1.5"
            disabled={isAdded || isAdding || addDisabled}
            onClick={onAdd}
          >
            {isAdded ? (
              <Check className="size-3" />
            ) : isAdding ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )}
            {isAdded ? "Card added" : "Add to deck"}
          </Button>
          <div className="mx-1 h-4 w-px bg-border/30" />
        </>

        <div className="flex items-center gap-px p-px">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              "gap-1.5 text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
              showPermutations && "text-foreground",
            )}
            onClick={onTogglePermutations}
          >
            <ListTree className="size-3" />
            Permutations
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              "gap-1.5 text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
              showCloze && "text-foreground",
            )}
            onClick={onToggleCloze}
          >
            <Braces className="size-3" />
            Cloze
          </Button>
        </div>

        <div className="flex-1" />

        <Button type="button" variant="destructive" size="xs" onClick={onDelete}>
          <Trash2 className="size-3" />
        </Button>
      </div>

      {(showPermutations || permutationsMounted) && (
        <div hidden={!showPermutations} className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
          <PermutationsPanel sourceCardId={card.id} />
        </div>
      )}

      {(showCloze || clozeMounted) && (
        <div hidden={!showCloze} className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
          <ClozePanel sourceCardId={card.id} />
        </div>
      )}
    </div>
  );
}
