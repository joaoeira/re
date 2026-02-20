import { AlertCircle, ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { cn } from "@shared/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DeckTreeNode } from "@re/workspace";
import { DeckStateBadges } from "./deck-state-badges";

type CheckedState = boolean | "indeterminate";

type DeckRowProps = {
  readonly node: DeckTreeNode;
  readonly depth: number;
  readonly isCollapsed: boolean;
  readonly checkboxState: CheckedState;
  readonly descendantDeckPaths: readonly string[];
  readonly onToggleCollapse: (path: string) => void;
  readonly onToggleDeckSelection: (relativePath: string) => void;
  readonly onToggleFolderSelection: (
    relativePath: string,
    descendantDeckPaths: readonly string[],
  ) => void;
  readonly onDeckTitleClick: (relativePath: string) => void;
};

export function DeckRow({
  node,
  depth,
  isCollapsed,
  checkboxState,
  descendantDeckPaths,
  onToggleCollapse,
  onToggleDeckSelection,
  onToggleFolderSelection,
  onDeckTitleClick,
}: DeckRowProps) {
  const isGroup = node.kind === "group";
  const isError = node.kind === "leaf" && node.snapshot.status !== "ok";

  const stateCounts = isGroup
    ? node.stateCounts
    : node.snapshot.status === "ok"
      ? node.snapshot.stateCounts
      : null;

  const totalCards = isGroup
    ? node.totalCards
    : node.snapshot.status === "ok"
      ? node.snapshot.totalCards
      : null;

  const dueCards = isGroup
    ? node.dueCards
    : node.snapshot.status === "ok"
      ? node.snapshot.dueCards
      : null;

  const checkboxChecked = checkboxState === true;
  const checkboxIndeterminate = checkboxState === "indeterminate";

  return (
    <div
      role="listitem"
      className={cn(
        "flex w-full items-center gap-2 border-b border-border py-2 pr-3 text-left transition-colors",
        "hover:bg-accent/50",
        isError && "opacity-60",
      )}
      style={{ paddingLeft: `${depth * 20 + 12}px` }}
    >
      {isGroup ? (
        <button
          type="button"
          onClick={() => onToggleCollapse(node.relativePath)}
          aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}

      <Checkbox
        checked={checkboxChecked}
        indeterminate={checkboxIndeterminate}
        onCheckedChange={() => {
          if (isGroup) {
            onToggleFolderSelection(node.relativePath, descendantDeckPaths);
            return;
          }

          onToggleDeckSelection(node.relativePath);
        }}
        aria-label={`Select ${node.name}`}
        disabled={isGroup && descendantDeckPaths.length === 0}
      />

      {isGroup ? (
        <Folder size={16} className="shrink-0 text-muted-foreground" />
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

      {isGroup ? (
        <span className="min-w-0 truncate text-sm font-medium text-foreground">{node.name}</span>
      ) : (
        <button
          type="button"
          onClick={() => onDeckTitleClick(node.relativePath)}
          className="min-w-0 truncate text-left text-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {node.name}
        </button>
      )}

      <span className="flex-1" />

      {stateCounts && <DeckStateBadges stateCounts={stateCounts} />}

      {dueCards !== null && dueCards > 0 && (
        <span className="ml-2 shrink-0 rounded-sm bg-state-review/10 px-1.5 py-0.5 text-xs tabular-nums font-medium text-state-review">
          {dueCards} due
        </span>
      )}

      {totalCards !== null && (
        <span className="ml-2 shrink-0 text-xs tabular-nums text-muted-foreground">
          {totalCards}
        </span>
      )}

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
