import { cn } from "@/lib/utils";

type CardTypeSelectorProps = {
  readonly cardType: "qa" | "cloze";
  readonly onChange: (cardType: "qa" | "cloze") => void;
  readonly disabled?: boolean;
};

export function CardTypeSelector({
  cardType,
  onChange,
  disabled = false,
}: CardTypeSelectorProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Card Type</span>
      <div className="flex border border-border">
        {(["qa", "cloze"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value)}
            className={cn(
              "h-8 px-3 text-xs transition-colors",
              value === cardType
                ? "bg-foreground text-background"
                : "bg-background text-foreground hover:bg-muted",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {value === "qa" ? "Q/A" : "Cloze"}
          </button>
        ))}
      </div>
    </div>
  );
}
