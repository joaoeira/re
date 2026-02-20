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
      <div className="pointer-events-auto w-full border-t border-foreground/10 bg-foreground px-6 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="text-xs uppercase tracking-widest text-primary-foreground/50">
            {mode === "reveal" ? "Review" : "Grade"}
          </span>

          {mode === "reveal" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReveal}
              className="group gap-3 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              <Eye className="size-4 opacity-50 transition-opacity group-hover:opacity-100" />
              <span className="text-sm font-medium">Show Answer</span>
              <Kbd>Space</Kbd>
            </Button>
          ) : (
            <GradeButtons disabled={gradingDisabled} onGrade={onGrade} />
          )}

          <span className="tabular-nums text-xs text-primary-foreground/30">{progress}</span>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { readonly children: React.ReactNode }) {
  return (
    <kbd className="border border-primary-foreground/20 bg-primary-foreground/10 px-1.5 py-0.5 text-[10px] text-primary-foreground/40">
      {children}
    </kbd>
  );
}
