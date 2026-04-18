import { cn } from "@/lib/utils";
import type { ForgeTopicCardsStatus } from "@shared/rpc/schemas/forge";
import { CheckIcon, MoreHorizontalIcon } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SidebarTopicRowProps = {
  readonly topicKey: string;
  readonly text: string;
  readonly active: boolean;
  readonly checked: boolean;
  readonly selectionMode: boolean;
  readonly status: ForgeTopicCardsStatus;
  readonly cardCount: number;
  readonly addedCount: number;
  readonly markedDone: boolean;
  readonly onSelect: (topicKey: string) => void;
  readonly onCheck: (topicKey: string) => void;
  readonly onGenerate: (topicKey: string) => void;
  readonly onToggleMarkedDone: (topicKey: string, markedDone: boolean) => void;
};

function StatusDot({
  status,
  allAdded,
  markedDone,
}: {
  readonly status: ForgeTopicCardsStatus;
  readonly allAdded: boolean;
  readonly markedDone: boolean;
}) {
  const base = "inline-block size-2 shrink-0 rounded-full";

  if (markedDone)
    return (
      <span className="inline-flex size-2.5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="size-2" strokeWidth={3} />
      </span>
    );
  if (status === "error") return <span className={cn(base, "bg-destructive")} />;
  if (status === "generating")
    return (
      <span className="inline-block size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-transparent" />
    );
  if (status === "idle") return <span className={cn(base, "border border-muted-foreground/30")} />;
  if (allAdded) return <span className={cn(base, "bg-primary")} />;
  return <span className={cn(base, "bg-muted-foreground/50")} />;
}

function CheckboxIndicator({ checked }: { readonly checked: boolean }) {
  return (
    <span
      className={cn(
        "flex size-3.5 items-center justify-center rounded-sm border transition-colors",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
    >
      {checked && <CheckIcon className="size-2.5" />}
    </span>
  );
}

type TopicMenuItemsProps = {
  readonly status: ForgeTopicCardsStatus;
  readonly cardCount: number;
  readonly markedDone: boolean;
  readonly onGenerate: () => void;
  readonly onToggleMarkedDone: () => void;
  readonly ItemComponent: typeof DropdownMenuItem | typeof ContextMenuItem;
};

function TopicMenuItems({
  status,
  cardCount,
  markedDone,
  onGenerate,
  onToggleMarkedDone,
  ItemComponent,
}: TopicMenuItemsProps) {
  const generateLabel = cardCount > 0 ? "Regenerate cards" : "Generate cards";
  const generateDisabled = status === "generating";
  const doneLabel = markedDone ? "Mark as not done" : "Mark as done";

  return (
    <>
      <ItemComponent disabled={generateDisabled} onClick={onGenerate}>
        {generateLabel}
      </ItemComponent>
      <ItemComponent onClick={onToggleMarkedDone}>{doneLabel}</ItemComponent>
    </>
  );
}

export function SidebarTopicRow({
  topicKey,
  text,
  active,
  checked,
  selectionMode,
  status,
  cardCount,
  addedCount,
  markedDone,
  onSelect,
  onCheck,
  onGenerate,
  onToggleMarkedDone,
}: SidebarTopicRowProps) {
  const allAdded = cardCount > 0 && addedCount === cardCount;
  const handleGenerate = () => onGenerate(topicKey);
  const handleToggleMarkedDone = () => onToggleMarkedDone(topicKey, !markedDone);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className={cn(
            "group flex w-full items-stretch border-l-2 transition-colors",
            checked && active
              ? "border-primary/60 bg-primary/10"
              : checked
                ? "border-primary/60 bg-primary/5"
                : active
                  ? "border-muted-foreground/60 bg-muted/50"
                  : "border-transparent hover:bg-muted/30",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(topicKey)}
            className="flex min-w-0 flex-1 items-start gap-2.5 px-4 py-2.5 text-left outline-none"
          >
            <div
              className="flex w-3.5 shrink-0 items-center justify-center pt-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onCheck(topicKey);
              }}
            >
              <div className={cn("hidden", selectionMode ? "!block" : "group-hover:block")}>
                <CheckboxIndicator checked={checked} />
              </div>
              <div className={cn("block", selectionMode ? "hidden" : "group-hover:hidden")}>
                <StatusDot status={status} allAdded={allAdded} markedDone={markedDone} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "line-clamp-2 text-xs leading-relaxed",
                  markedDone
                    ? "text-muted-foreground/50"
                    : checked || active
                      ? "text-foreground/80"
                      : "text-muted-foreground/70",
                )}
              >
                {text}
              </p>
              {cardCount > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground/40">
                  {cardCount} cards
                  {allAdded && <span className="text-primary"> · done</span>}
                </p>
              )}
              {status === "error" && (
                <p className="mt-0.5 text-[10px] text-destructive">failed · retry</p>
              )}
            </div>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Topic actions"
              className={cn(
                "mr-2 mt-2.5 size-6 shrink-0 self-start rounded text-muted-foreground/60 outline-none transition-colors hover:bg-muted-foreground/10 hover:text-foreground focus-visible:opacity-100 data-popup-open:opacity-100 inline-flex items-center justify-center",
                "opacity-0 group-hover:opacity-100",
              )}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontalIcon className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={2}>
              <TopicMenuItems
                status={status}
                cardCount={cardCount}
                markedDone={markedDone}
                onGenerate={handleGenerate}
                onToggleMarkedDone={handleToggleMarkedDone}
                ItemComponent={DropdownMenuItem}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <TopicMenuItems
          status={status}
          cardCount={cardCount}
          markedDone={markedDone}
          onGenerate={handleGenerate}
          onToggleMarkedDone={handleToggleMarkedDone}
          ItemComponent={ContextMenuItem}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
