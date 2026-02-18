import { AlertCircle, ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { cn } from "@shared/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DeckTreeNode } from "@re/workspace";
import { DeckStateBadges } from "./deck-state-badges";

type DeckRowProps = {
  readonly node: DeckTreeNode;
  readonly depth: number;
  readonly isCollapsed: boolean;
  readonly onToggle: (path: string) => void;
  readonly onClick: (relativePath: string) => void;
};

export function DeckRow({ node, depth, isCollapsed, onToggle, onClick }: DeckRowProps) {
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

  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onClick(node.relativePath)}
      className={cn(
        "flex w-full items-center gap-2 border-b border-border py-2 pr-3 text-left transition-colors",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        isError && "opacity-60",
      )}
      style={{ paddingLeft: `${depth * 20 + 12}px` }}
    >
      {isGroup ? (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.relativePath);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onToggle(node.relativePath);
            }
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}

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

      <span className={cn("min-w-0 truncate text-sm text-foreground", isGroup && "font-medium")}>
        {node.name}
      </span>

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
    </button>
  );
}
