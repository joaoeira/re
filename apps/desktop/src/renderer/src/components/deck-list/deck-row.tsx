import { AlertCircle, ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { useDeckListStore, useDeckSelectionStore } from "@shared/state/stores-context";
import { cn } from "@shared/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DeckTreeNode } from "@re/workspace";
import { DeckInlineMetrics } from "./deck-inline-metrics";

type DeckRowProps = {
  readonly node: DeckTreeNode;
  readonly depth: number;
  readonly descendantDeckPaths: readonly string[];
};

export function DeckRow({ node, depth, descendantDeckPaths }: DeckRowProps) {
  const navigate = useNavigate();
  const deckListStore = useDeckListStore();
  const deckSelectionStore = useDeckSelectionStore();
  const isGroup = node.kind === "group";
  const isError = node.kind === "leaf" && node.snapshot.status !== "ok";

  const isCollapsed = useSelector(deckListStore, (s) =>
    isGroup ? node.relativePath in s.context.collapsed : false,
  );

  const selectionState = useSelector(deckSelectionStore, (s) => {
    if (isGroup) {
      if (descendantDeckPaths.length === 0) return "none" as const;
      let selectedCount = 0;
      for (const descendantPath of descendantDeckPaths) {
        if (descendantPath in s.context.selected) {
          selectedCount += 1;
        }
      }
      if (selectedCount === 0) return "none" as const;
      if (selectedCount === descendantDeckPaths.length) return "all" as const;
      return "partial" as const;
    }
    return node.relativePath in s.context.selected ? ("all" as const) : ("none" as const);
  });

  const handleToggleSelection = () => {
    if (isGroup) {
      deckSelectionStore.send({
        type: "toggleFolder",
        path: node.relativePath,
        descendantPaths: descendantDeckPaths,
      });
    } else {
      deckSelectionStore.send({ type: "toggleDeck", path: node.relativePath });
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    deckListStore.send({ type: "toggle", path: node.relativePath });
  };

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isGroup) {
      if (descendantDeckPaths.length === 0) return;
      void navigate({
        to: "/review",
        search: { decks: [...descendantDeckPaths] },
      });
    } else {
      void navigate({
        to: "/review",
        search: { decks: [node.relativePath] },
      });
    }
  };

  const handleRowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleToggleSelection();
    }
  };

  const newCount = isGroup
    ? node.stateCounts.new
    : node.snapshot.status === "ok"
      ? node.snapshot.stateCounts.new
      : 0;

  const dueCount = isGroup
    ? node.dueCards
    : node.snapshot.status === "ok"
      ? node.snapshot.dueCards
      : 0;

  return (
    <div
      role="option"
      aria-selected={selectionState === "all"}
      tabIndex={0}
      onClick={handleToggleSelection}
      onKeyDown={handleRowKeyDown}
      className={cn(
        "flex w-full cursor-pointer select-none items-center gap-2 py-2 pr-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selectionState === "all" && "bg-state-review/5 hover:bg-state-review/8",
        selectionState === "partial" && "bg-state-review/[2%] hover:bg-state-review/4",
        selectionState === "none" && "hover:bg-accent/50",
        isError && "opacity-60",
      )}
      style={{ paddingLeft: `${depth * 20 + 12}px` }}
    >
      {isGroup ? (
        <button
          type="button"
          onClick={handleChevronClick}
          aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
          tabIndex={-1}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}

      {isGroup ? (
        <Folder
          size={16}
          className={cn(
            "shrink-0 transition-colors",
            selectionState !== "none" ? "text-state-review" : "text-muted-foreground",
          )}
        />
      ) : isError ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className="flex shrink-0" />}>
              <AlertCircle size={16} className="text-destructive" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-xs text-xs">
                {(node.snapshot.status === "read_error" ||
                  node.snapshot.status === "parse_error") &&
                  node.snapshot.message}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <FileText size={16} className="shrink-0 text-muted-foreground" />
      )}

      <button
        type="button"
        onClick={handleNameClick}
        tabIndex={-1}
        className={cn(
          "min-w-0 cursor-pointer truncate text-left text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isGroup ? "font-medium text-foreground" : "text-foreground",
        )}
      >
        {node.name}
      </button>

      <DeckInlineMetrics newCount={newCount} dueCount={dueCount} />

      <span className="flex-1" />

      {isGroup && node.errorCount > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="ml-1 flex shrink-0 items-center gap-0.5 text-xs text-destructive" />
              }
            >
              <AlertCircle size={12} />
              {node.errorCount}
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {node.errorCount} deck{node.errorCount > 1 ? "s" : ""} with errors
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
