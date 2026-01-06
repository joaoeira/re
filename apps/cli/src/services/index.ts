import { Layer } from "effect"
import { BunFileSystem } from "@effect/platform-bun"

export {
  DeckDiscovery,
  DeckDiscoveryLive,
  type DiscoveryResult,
} from "./DeckDiscovery"
export {
  Scheduler,
  SchedulerLive,
  ScheduleError,
  type FSRSGrade,
  type ScheduleResult,
  type SchedulerLog,
  type ReviewLogEntry,
  computeDueDate,
  computeElapsedDays,
  computeScheduledDays,
  itemMetadataToFSRSCard,
  fsrsCardToItemMetadata,
} from "./Scheduler"
export { DeckWriter, DeckWriterLive, DeckWriteError } from "./DeckWriter"
export {
  DeckParser,
  DeckParserLive,
  DeckReadError,
  DeckParseError,
  type DeckParserError,
  type ParsedDeck,
} from "./DeckParser"
export { DeckLoader, DeckLoaderLive, type DeckStats } from "./DeckLoader"
export { buildDeckTree, type DeckTreeNode } from "../lib/buildDeckTree"
export {
  ReviewQueueService,
  ReviewQueueServiceLive,
  ReviewQueueLive,
  QueueOrderingStrategy,
  NewFirstOrderingStrategy,
  DueFirstOrderingStrategy,
  type Selection,
  type QueueItem,
  type ReviewQueue,
} from "./ReviewQueue"

import { DeckDiscoveryLive } from "./DeckDiscovery"
import { SchedulerLive } from "./Scheduler"
import { DeckParserLive } from "./DeckParser"
import { DeckLoaderLive } from "./DeckLoader"
import { ReviewQueueLive } from "./ReviewQueue"

// Base layer: FileSystem + Scheduler + DeckParser
const BaseLive = Layer.mergeAll(
  BunFileSystem.layer,
  SchedulerLive,
  DeckParserLive.pipe(Layer.provide(BunFileSystem.layer))
)

// Full application layer
export const AppLive = Layer.mergeAll(
  DeckDiscoveryLive,
  DeckLoaderLive,
  ReviewQueueLive
).pipe(Layer.provide(BaseLive))
