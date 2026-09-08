import type { ReviewGrade } from "./review-controls";

export interface SessionProgress {
  readonly queue: readonly string[];
  readonly grades: readonly ReviewGrade[];
}

// Every grade advances once. FSRS alone decides when a card is due again.
export const gradeSession = (session: SessionProgress, grade: ReviewGrade): SessionProgress => ({
  queue: session.queue.slice(1),
  grades: [...session.grades, grade],
});

export const removeSessionCards = (
  session: SessionProgress,
  ids: readonly string[],
): SessionProgress => ({
  ...session,
  queue: session.queue.filter((id) => !ids.includes(id)),
});
