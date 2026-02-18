import { Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { Path } from "@effect/platform";

export { DeckDiscovery, DeckDiscoveryLive, type DiscoveryResult } from "./DeckDiscovery";
export {
  IgnoreFileService,
  IgnoreFileServiceLive,
  IGNORE_FILE,
  parseIgnoreFile,
  type IgnoreMap,
} from "./IgnoreFileService";
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
} from "./Scheduler";
export { DeckManager, DeckManagerLive } from "@re/workspace";
export {
  QueueOrderingStrategy,
  NewFirstOrderingStrategy,
  DueFirstOrderingStrategy,
  type QueueItem,
  type ReviewQueue,
} from "@re/workspace";
export { DeckLoader, DeckLoaderLive, type DeckStats } from "./DeckLoader";
export { buildDeckTree, type DeckTreeNode } from "../lib/buildDeckTree";
export {
  ReviewQueueService,
  ReviewQueueServiceLive,
  ReviewQueueLive,
  type Selection,
} from "./ReviewQueue";

import { DeckManagerLive } from "@re/workspace";
import { DeckDiscoveryLive } from "./DeckDiscovery";
import { IgnoreFileServiceLive } from "./IgnoreFileService";
import { SchedulerLive } from "./Scheduler";
import { DeckLoaderLive } from "./DeckLoader";
import { ReviewQueueLive } from "./ReviewQueue";

const FileSystemAndPath = Layer.mergeAll(BunFileSystem.layer, Path.layer);

const BaseLive = Layer.mergeAll(
  FileSystemAndPath,
  SchedulerLive,
  DeckManagerLive.pipe(Layer.provide(FileSystemAndPath)),
  IgnoreFileServiceLive.pipe(Layer.provide(FileSystemAndPath)),
);

export const AppLive = Layer.mergeAll(
  Path.layer,
  DeckDiscoveryLive,
  DeckLoaderLive,
  ReviewQueueLive,
).pipe(Layer.provide(BaseLive));
