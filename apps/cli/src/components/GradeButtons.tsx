import { themeColors as theme } from "../ThemeContext";
import type { FSRSGrade } from "../services/Scheduler";

interface GradeButtonsProps {
  onGrade: (grade: FSRSGrade) => void;
}

const grades: {
  grade: FSRSGrade;
  label: string;
  key: string;
  color: string;
}[] = [
  { grade: 0, label: "Again", key: "1", color: theme.textMuted },
  { grade: 1, label: "Hard", key: "2", color: theme.textMuted },
  { grade: 2, label: "Good", key: "3", color: theme.textMuted },
  { grade: 3, label: "Easy", key: "4", color: theme.textMuted },
];

export function GradeButtons({ onGrade }: GradeButtonsProps) {
  return (
    <box flexDirection="row" gap={2}>
      {grades.map(({ grade, label, key, color }) => (
        <box key={key} flexDirection="row">
          <text fg={theme.textMuted}>[{key}]</text>
          <text fg={color}> {label}</text>
        </box>
      ))}
    </box>
  );
}
