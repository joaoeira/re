import { Context, Layer } from "effect"
import { type ItemMetadata, State } from "@re/core"

export interface Scheduler {
  readonly isDue: (card: ItemMetadata, now: Date) => boolean
  readonly getReviewDate: (card: ItemMetadata) => Date | null
}

export const Scheduler = Context.GenericTag<Scheduler>("Scheduler")

export const SchedulerLive = Layer.succeed(Scheduler, {
  isDue: (card, now) => {
    // New cards are not "due" - they're "new"
    if (card.state === State.New) return false

    // No lastReview means not due (shouldn't happen for non-new cards)
    if (!card.lastReview) return false

    // stability represents interval in days
    const intervalMs = card.stability.value * 24 * 60 * 60 * 1000
    const dueDate = new Date(card.lastReview.getTime() + intervalMs)

    return dueDate <= now
  },

  getReviewDate: (card) => {
    if (card.state === State.New || !card.lastReview) return null

    const intervalMs = card.stability.value * 24 * 60 * 60 * 1000
    return new Date(card.lastReview.getTime() + intervalMs)
  },
})
