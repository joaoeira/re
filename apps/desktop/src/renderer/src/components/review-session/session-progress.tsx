type SessionProgressProps = {
  readonly current: number;
  readonly total: number;
};

export function SessionProgress({ current, total }: SessionProgressProps) {
  return (
    <span className="absolute right-6 top-5 text-[10px] text-muted-foreground/70">
      {current} / {total}
    </span>
  );
}
