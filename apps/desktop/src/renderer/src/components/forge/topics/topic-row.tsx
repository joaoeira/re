import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

type TopicRowProps = {
  readonly text: string;
  readonly selected: boolean;
  readonly onToggle: () => void;
};

export function TopicRow({ text, selected, onToggle }: TopicRowProps) {
  return (
    <div
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded px-2.5 py-2 transition-colors",
        selected ? "bg-primary/6 hover:bg-primary/10" : "hover:bg-muted/50",
      )}
      onClick={onToggle}
    >
      <Checkbox checked={selected} onCheckedChange={onToggle} className="mt-0.5 shrink-0" />
      <span className="text-[13.5px] leading-relaxed text-foreground/80">{text}</span>
    </div>
  );
}
