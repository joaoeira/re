import type { FSRSGrade } from "@shared/rpc/schemas/review";

import { Button } from "@/components/ui/button";
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
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto border border-border bg-foreground px-3 py-2 shadow-lg">
        {mode === "reveal" ? (
          <Button type="button" size="sm" variant="secondary" onClick={onReveal}>
            Show Answer
          </Button>
        ) : (
          <GradeButtons disabled={gradingDisabled} onGrade={onGrade} />
        )}
      </div>
    </div>
  );
}
