type DuplicateWarningProps = {
  readonly deckPath: string | null;
};

const basename = (value: string): string => {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? normalized;
};

export function DuplicateWarning({ deckPath }: DuplicateWarningProps) {
  return (
    <div className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      Duplicate card content detected
      {deckPath ? ` in ${basename(deckPath)}.` : "."}
    </div>
  );
}
