import type { FSRSGrade } from "@shared/rpc/schemas/review";

import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GradeButtons } from "@/components/review-session/grade-buttons";

type ReviewActionBarProps = {
  readonly mode: "reveal" | "grade";
  readonly onReveal: () => void;
  readonly onGrade: (grade: FSRSGrade) => void;
  readonly gradingDisabled: boolean;
  readonly progress: string;
};

export function ReviewActionBar({
  mode,
  onReveal,
  onGrade,
  gradingDisabled,
  progress,
}: ReviewActionBarProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="pointer-events-auto w-full border-t border-border bg-muted/30 px-6 py-2.5">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {mode === "reveal" ? "Review" : "Grade"}
          </span>

          {mode === "reveal" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onReveal}
              className="group gap-3 hover:bg-foreground hover:text-background"
            >
              <Eye className="size-3.5 opacity-50 transition-opacity group-hover:opacity-100" />
              <span className="text-xs">Show Answer</span>
              <Kbd>Space</Kbd>
            </Button>
          ) : (
            <GradeButtons disabled={gradingDisabled} onGrade={onGrade} />
          )}

          <span className="tabular-nums text-xs text-muted-foreground">{progress}</span>
        </div>
      </div>
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
