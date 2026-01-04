import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import { Scheduler, SchedulerLive } from "../../src/services/Scheduler"
import { State, numericField, generateId } from "@re/core"
import type { ItemMetadata, ItemId } from "@re/core"

const makeCard = (
  state: number,
  stability: number,
  lastReview: Date | null
): ItemMetadata => ({
  id: generateId() as ItemId,
  stability: numericField(stability),
  difficulty: numericField(5),
  state: state as 0 | 1 | 2 | 3,
  learningSteps: 0,
  lastReview,
})

describe("Scheduler", () => {
  it("new cards are not due", async () => {
    const result = await Effect.gen(function* () {
      const scheduler = yield* Scheduler
      const card = makeCard(State.New, 1, null)
      return scheduler.isDue(card, new Date())
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise)

    expect(result).toBe(false)
  })

  it("review card is due when past interval", async () => {
    const now = new Date("2025-01-04T12:00:00Z")
    const lastReview = new Date("2025-01-01T12:00:00Z") // 3 days ago

    const result = await Effect.gen(function* () {
      const scheduler = yield* Scheduler
      const card = makeCard(State.Review, 2, lastReview) // 2 day stability
      return scheduler.isDue(card, now)
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise)

    expect(result).toBe(true) // 3 days > 2 day interval
  })

  it("review card is not due when within interval", async () => {
    const now = new Date("2025-01-04T12:00:00Z")
    const lastReview = new Date("2025-01-03T12:00:00Z") // 1 day ago

    const result = await Effect.gen(function* () {
      const scheduler = yield* Scheduler
      const card = makeCard(State.Review, 5, lastReview) // 5 day stability
      return scheduler.isDue(card, now)
    }).pipe(Effect.provide(SchedulerLive), Effect.runPromise)

    expect(result).toBe(false) // 1 day < 5 day interval
  })
})
