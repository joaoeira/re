import type { FSRSGrade } from "@shared/rpc/schemas/review";

import { Button } from "@/components/ui/button";

type GradeButtonsProps = {
  readonly disabled: boolean;
  readonly onGrade: (grade: FSRSGrade) => void;
};

const gradeButtons: ReadonlyArray<{ label: string; grade: FSRSGrade }> = [
  { label: "Again", grade: 0 },
  { label: "Hard", grade: 1 },
  { label: "Good", grade: 2 },
  { label: "Easy", grade: 3 },
];

export function GradeButtons({ disabled, onGrade }: GradeButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      {gradeButtons.map(({ label, grade }) => (
        <Button
          key={grade}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onGrade(grade)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

