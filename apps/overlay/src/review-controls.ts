import type { EventPayload } from "@gpuix/react";

export const gradeValues = { again: 0, hard: 1, good: 2, easy: 3 } as const;
export type ReviewGrade = keyof typeof gradeValues;

export function reviewKey(event: EventPayload, revealed: boolean): ReviewGrade | "reveal" | null {
  if (
    event.isHeld ||
    event.modifiers?.cmd ||
    event.modifiers?.ctrl ||
    event.modifiers?.alt ||
    event.modifiers?.shift
  )
    return null;
  if (event.key === "space" || event.key === " ") return revealed ? "good" : "reveal";
  if (!revealed) return null;
  return (
    ({ "1": "again", "2": "hard", "3": "good", "4": "easy" } as Record<string, ReviewGrade>)[
      event.key ?? ""
    ] ?? null
  );
}
