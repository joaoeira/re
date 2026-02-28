import { cn } from "@/lib/utils";
import type { ForgeTopicCardsStatus } from "@shared/rpc/schemas/forge";
import { CheckIcon } from "lucide-react";

type SidebarTopicRowProps = {
  readonly topicKey: string;
  readonly text: string;
  readonly active: boolean;
  readonly checked: boolean;
  readonly selectionMode: boolean;
  readonly status: ForgeTopicCardsStatus;
  readonly cardCount: number;
  readonly addedCount: number;
  readonly onSelect: (topicKey: string) => void;
  readonly onCheck: (topicKey: string) => void;
};

function StatusDot({
  status,
  allAdded,
}: {
  readonly status: ForgeTopicCardsStatus;
  readonly allAdded: boolean;
}) {
  const base = "inline-block size-2 shrink-0 rounded-full";

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

export function SidebarTopicRow({
  topicKey,
  text,
  active,
  checked,
  selectionMode,
  status,
  cardCount,
  addedCount,
  onSelect,
  onCheck,
}: SidebarTopicRowProps) {
  const allAdded = cardCount > 0 && addedCount === cardCount;

  return (
    <button
      type="button"
      onClick={() => onSelect(topicKey)}
      className={cn(
        "group flex w-full items-start gap-2.5 border-l-2 px-4 py-2.5 text-left transition-colors",
        checked && active
          ? "border-primary/60 bg-primary/10"
          : checked
            ? "border-primary/60 bg-primary/5"
            : active
              ? "border-muted-foreground/60 bg-muted/50"
              : "border-transparent hover:bg-muted/30",
      )}
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
          <StatusDot status={status} allAdded={allAdded} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "line-clamp-2 text-xs leading-relaxed",
            checked || active ? "text-foreground/80" : "text-muted-foreground/70",
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
  );
}
