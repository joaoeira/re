type SessionProgressProps = {
  readonly done: number;
  readonly total: number;
};

export function SessionProgress({ done, total }: SessionProgressProps) {
  return (
    <span className="absolute right-6 top-5 text-[10px] text-muted-foreground/70">
      {total - done} remaining
    </span>
  );
}
