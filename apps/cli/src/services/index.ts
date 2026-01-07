import { Layer } from "effect"
import { BunFileSystem } from "@effect/platform-bun"
import { Path } from "@effect/platform"

export {
  DeckDiscovery,
  DeckDiscoveryLive,
  type DiscoveryResult,
} from "./DeckDiscovery"
export {
  IgnoreFileService,
  IgnoreFileServiceLive,
  IGNORE_FILE,
  parseIgnoreFile,
  type IgnoreMap,
} from "./IgnoreFileService"
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
import { IgnoreFileServiceLive } from "./IgnoreFileService"
import { SchedulerLive } from "./Scheduler"
import { DeckParserLive } from "./DeckParser"
import { DeckLoaderLive } from "./DeckLoader"
import { ReviewQueueLive } from "./ReviewQueue"

const FileSystemAndPath = Layer.mergeAll(BunFileSystem.layer, Path.layer)

// Base layer: FileSystem + Path + Scheduler + DeckParser + IgnoreFileService
const BaseLive = Layer.mergeAll(
  FileSystemAndPath,
  SchedulerLive,
  DeckParserLive.pipe(Layer.provide(FileSystemAndPath)),
  IgnoreFileServiceLive.pipe(Layer.provide(FileSystemAndPath))
)

// Full application layer
export const AppLive = Layer.mergeAll(
  Path.layer,
  DeckDiscoveryLive,
  DeckLoaderLive,
  ReviewQueueLive
).pipe(Layer.provide(BaseLive))
