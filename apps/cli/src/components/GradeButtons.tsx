import { themeColors as theme } from "../ThemeContext";

const grades: {
  label: string;
  key: string;
  color: string;
  isDefault?: boolean;
}[] = [
  { label: "Again", key: "1", color: theme.textMuted },
  { label: "Hard", key: "2", color: theme.textMuted },
  { label: "Good", key: "3", color: theme.text, isDefault: true },
  { label: "Easy", key: "4", color: theme.textMuted },
];

export function GradeButtons() {
  return (
    <box flexDirection="row" gap={2}>
      {grades.map(({ label, key, color }) => (
        <box key={key} flexDirection="row">
          <text fg={theme.textMuted}>[{key}]</text>
          <text fg={color}> {label}</text>
        </box>
      ))}
    </box>
  );
}
