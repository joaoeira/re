import type { FSRSGrade } from "@shared/rpc/schemas/review";

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
        <button
          key={grade}
          type="button"
          disabled={disabled}
          onClick={() => onGrade(grade)}
          className="flex items-center gap-2 border border-transparent px-3 py-1 text-xs text-foreground transition-colors hover:border-border disabled:opacity-30"
        >
          <span>{label}</span>
          <kbd className="border border-border px-1 py-0.5 text-[10px] text-muted-foreground">
            {key}
          </kbd>
        </button>
      ))}
    </div>
  );
}
