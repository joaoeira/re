import type { FSRSGrade } from "@shared/rpc/schemas/review";

import { Button } from "@/components/ui/button";

type GradeButtonsProps = {
  readonly disabled: boolean;
  readonly onGrade: (grade: FSRSGrade) => void;
};

const gradeButtons: ReadonlyArray<{ label: string; grade: FSRSGrade; key: string }> = [
  { label: "Again", grade: 0, key: "1" },
  { label: "Hard", grade: 1, key: "2" },
  { label: "Good", grade: 2, key: "3" },
  { label: "Easy", grade: 3, key: "4" },
];

export function GradeButtons({ disabled, onGrade }: GradeButtonsProps) {
  return (
    <div className="flex items-center gap-1">
      {gradeButtons.map(({ label, grade, key }) => (
        <Button
          key={grade}
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onGrade(grade)}
          className="gap-2 text-foreground hover:bg-muted disabled:opacity-30"
        >
          <span className="text-xs">{label}</span>
          <kbd className="border border-border px-1 py-0.5 text-[10px] text-muted-foreground/60">
            {key}
          </kbd>
        </Button>
      ))}
    </div>
  );
}
