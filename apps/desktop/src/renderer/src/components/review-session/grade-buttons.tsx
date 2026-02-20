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
          className="gap-2 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground disabled:opacity-30"
        >
          <span className="text-sm">{label}</span>
          <kbd className="border border-primary-foreground/20 bg-primary-foreground/5 px-1 py-0.5 text-[10px] text-primary-foreground/30">
            {key}
          </kbd>
        </Button>
      ))}
    </div>
  );
}
