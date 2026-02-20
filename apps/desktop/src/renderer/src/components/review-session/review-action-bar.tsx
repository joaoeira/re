import type { FSRSGrade } from "@shared/rpc/schemas/review";

import { GradeButtons } from "@/components/review-session/grade-buttons";

type ReviewActionBarProps = {
  readonly mode: "reveal" | "grade";
  readonly onReveal: () => void;
  readonly onGrade: (grade: FSRSGrade) => void;
  readonly gradingDisabled: boolean;
};

export function ReviewActionBar({
  mode,
  onReveal,
  onGrade,
  gradingDisabled,
}: ReviewActionBarProps) {
  return (
    <div className="shrink-0 border-t border-border bg-muted/30 px-6 py-2.5">
      {mode === "reveal" ? (
        <div className="mx-auto flex max-w-xl items-center justify-center">
          <button
            type="button"
            onClick={onReveal}
            className="flex items-center gap-3 border border-border px-3 py-1 text-xs transition-colors hover:border-foreground"
          >
            <span>Show Answer</span>
            <Kbd>Space</Kbd>
          </button>
        </div>
      ) : (
        <div className="mx-auto flex max-w-xl items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Grade</span>
          <GradeButtons disabled={gradingDisabled} onGrade={onGrade} />
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd className="border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
      {children}
    </kbd>
  );
}
