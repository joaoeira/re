import type { SchedulerLog } from "@re/workspace";

export interface ReviewLogEntry extends SchedulerLog {
  readonly queueIndex: number;
  readonly deckPath: string;
  readonly cardId: string;
}
