import { useState } from "react";
import { Check, ListTree, Braces, Trash2, Plus } from "lucide-react";

import { ClozePreview } from "@/components/editor/cloze-preview";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ForgeCard } from "./mock-cards-data";
import { ClozePanel } from "./cloze-panel";
import { PermutationsPanel } from "./permutations-panel";

type CardBlockProps = {
  readonly card: ForgeCard;
  readonly isAdded: boolean;
  readonly onAdd: () => void;
  readonly onDelete: () => void;
  readonly onEditQuestion: (value: string) => void;
  readonly onEditAnswer: (value: string) => void;
  readonly onAddPermutation: () => void;
  readonly onAddCloze: () => void;
};

export function CardBlock({
  card,
  isAdded,
  onAdd,
  onDelete,
  onEditQuestion,
  onEditAnswer,
  onAddPermutation,
  onAddCloze,
}: CardBlockProps) {
  const [showPermutations, setShowPermutations] = useState(false);
  const [showCloze, setShowCloze] = useState(false);

  const hasExpanded = showPermutations || showCloze;

  return (
    <div className="group relative border-b border-border/30 px-2 py-5">
      <div className={cn("transition-opacity", isAdded && "opacity-40")}>
        {isAdded && (
          <div className="mb-3 flex items-center gap-1.5 text-[11px] text-primary">
            <Check className="size-3" />
            Added to deck
          </div>
        )}

        <div
          contentEditable={!isAdded}
          suppressContentEditableWarning
          className={cn(
            "px-2 py-1 -mx-2 text-[15px] font-medium leading-relaxed text-foreground outline-none transition-colors",
            !isAdded && "hover:bg-muted/20 focus:bg-muted/20",
          )}
          onBlur={(e) => onEditQuestion(e.currentTarget.textContent ?? "")}
        >
          {card.question}
        </div>

        <div
          contentEditable={!isAdded}
          suppressContentEditableWarning
          className={cn(
            "mt-1.5 px-2 py-1 -mx-2 text-sm leading-relaxed text-muted-foreground outline-none transition-colors",
            !isAdded && "hover:bg-muted/20 focus:bg-muted/20",
          )}
          onBlur={(e) => onEditAnswer(e.currentTarget.textContent ?? "")}
        >
          {card.answer}
        </div>

        {card.type === "cloze" && card.clozeText && (
          <div className="mt-3 bg-muted/20 px-3 py-2.5">
            <ClozePreview content={card.clozeText} />
          </div>
        )}
      </div>

      <div
        className={cn(
          "mt-3 flex items-center gap-1.5 transition-all",
          hasExpanded
            ? "opacity-100"
            : "translate-y-0.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
        )}
      >
        {!isAdded && (
          <>
            <Button type="button" variant="secondary" size="xs" className="gap-1.5" onClick={onAdd}>
              <Plus className="size-3" />
              Add to deck
            </Button>
            <div className="mx-1 h-4 w-px bg-border/30" />
          </>
        )}

        <div className="flex items-center gap-px p-px">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              "gap-1.5 text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
              showPermutations && "text-foreground",
            )}
            onClick={() => setShowPermutations((v) => !v)}
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
            onClick={() => setShowCloze((v) => !v)}
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

      {showPermutations && (
        <div className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
          <PermutationsPanel onAddPermutation={onAddPermutation} />
        </div>
      )}

      {showCloze && (
        <div className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
          <ClozePanel onAddCloze={onAddCloze} />
        </div>
      )}
    </div>
  );
}
