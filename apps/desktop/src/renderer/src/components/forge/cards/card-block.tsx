import { useEffect, useState } from "react";
import { ListTree, Braces, Trash2, Loader2, ArrowRight, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ForgeGeneratedCard } from "@shared/rpc/schemas/forge";

import { AddToDeckButton } from "./add-to-deck-button";
import { ClozePanel } from "./cloze-panel";
import { InlineEditor } from "./inline-editor";
import { PermutationsPanel } from "./permutations-panel";

type CardBlockProps = {
  readonly card: ForgeGeneratedCard;
  readonly isAdded: boolean;
  readonly isAdding: boolean;
  readonly addDisabled: boolean;
  readonly expandedPanel: "permutations" | "cloze" | null;
  readonly expansionStatus: "idle" | "expanding" | "expanded";
  readonly isReformulating: boolean;
  readonly reformulateErrorMessage: string | null;
  readonly onAdd: () => void;
  readonly onDelete: () => void;
  readonly onReformulate: () => void;
  readonly onTogglePermutations: () => void;
  readonly onToggleCloze: () => void;
  readonly onRequestExpansion: () => void;
  readonly onEditQuestion: (value: string) => void;
  readonly onEditAnswer: (value: string) => void;
};

export function CardBlock({
  card,
  isAdded,
  isAdding,
  addDisabled,
  expandedPanel,
  expansionStatus,
  isReformulating,
  reformulateErrorMessage,
  onAdd,
  onDelete,
  onReformulate,
  onTogglePermutations,
  onToggleCloze,
  onRequestExpansion,
  onEditQuestion,
  onEditAnswer,
}: CardBlockProps) {
  const showPermutations = expandedPanel === "permutations";
  const showCloze = expandedPanel === "cloze";
  const hasExpanded = expandedPanel !== null || expansionStatus !== "idle";

  const [permutationsMounted, setPermutationsMounted] = useState(false);
  const [clozeMounted, setClozeMounted] = useState(false);

  useEffect(() => {
    if (showPermutations) setPermutationsMounted(true);
  }, [showPermutations]);

  useEffect(() => {
    if (showCloze) setClozeMounted(true);
  }, [showCloze]);

  return (
    <div
      className={cn(
        "group relative border-b border-border/30 px-2 py-5",
        expansionStatus !== "idle" && "bg-muted/15",
        isReformulating && "animate-pulse pointer-events-none",
      )}
    >
      <div className={cn("transition-opacity", isAdded && "opacity-40")}>
        <InlineEditor
          content={card.question}
          onContentChange={onEditQuestion}
          editable={!isAdded && !isReformulating}
          className="min-h-0 text-[15px] font-medium leading-relaxed"
        />

        <InlineEditor
          content={card.answer}
          onContentChange={onEditAnswer}
          editable={!isAdded && !isReformulating}
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
          <AddToDeckButton
            isAdded={isAdded}
            isAdding={isAdding}
            disabled={addDisabled || isReformulating}
            onClick={onAdd}
          />
          <div className="mx-1 h-4 w-px bg-border/30" />
        </>

        <div className="flex items-center gap-px p-px">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isReformulating}
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
            disabled={isReformulating}
            className={cn(
              "gap-1.5 text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
              showCloze && "text-foreground",
            )}
            onClick={onToggleCloze}
          >
            <Braces className="size-3" />
            Cloze
          </Button>
          <Button
            type="button"
            variant={expansionStatus !== "idle" ? "secondary" : "ghost"}
            size="xs"
            disabled={isReformulating}
            className={cn(
              "gap-1.5",
              expansionStatus === "idle" &&
                "text-muted-foreground/60 hover:bg-transparent hover:text-foreground",
            )}
            onClick={onRequestExpansion}
          >
            {expansionStatus === "expanding" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowRight className="size-3" />
            )}
            {expansionStatus === "expanding"
              ? "Expanding..."
              : expansionStatus === "expanded"
                ? "Expanded"
                : "Expand"}
          </Button>
        </div>

        <div className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Reformulate card"
          disabled={isAdded || isReformulating}
          onClick={onReformulate}
        >
          {isReformulating ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCcw className="size-3" />
          )}
        </Button>

        <Button
          type="button"
          variant="destructive"
          size="xs"
          disabled={isReformulating}
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {reformulateErrorMessage ? (
        <p className="mt-3 text-[11px] text-destructive">{reformulateErrorMessage}</p>
      ) : null}

      {(showPermutations || permutationsMounted) && (
        <div hidden={!showPermutations} className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
          <PermutationsPanel parent={{ cardId: card.id }} rootCardId={card.id} />
        </div>
      )}

      {(showCloze || clozeMounted) && (
        <div hidden={!showCloze} className="ml-5 mt-2 border-l-2 border-border/30 pl-5">
          <ClozePanel
            source={{ cardId: card.id }}
            sourceQuestion={card.question}
            sourceAnswer={card.answer}
          />
        </div>
      )}
    </div>
  );
}
