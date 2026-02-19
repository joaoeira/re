import { Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { Path } from "@effect/platform";
import { DeckManagerLive, ReviewQueueLive } from "@re/workspace";

export {
  Scheduler,
  SchedulerLive,
  ScheduleError,
  type FSRSGrade,
  type ScheduleResult,
  type SchedulerLog,
  computeDueDate,
  computeElapsedDays,
  computeScheduledDays,
  itemMetadataToFSRSCard,
  fsrsCardToItemMetadata,
} from "@re/workspace";
export { type ReviewLogEntry } from "./ReviewLogEntry";
export { DeckManager, DeckManagerLive } from "@re/workspace";
export { buildDeckTree, type DeckTreeNode } from "@re/workspace";
export {
  QueueOrderingStrategy,
  NewFirstOrderingStrategy,
  DueFirstOrderingStrategy,
  ReviewQueueBuilder,
  ReviewQueueBuilderLive,
  ReviewQueueService,
  ReviewQueueServiceLive,
  ReviewQueueLive,
  collectDeckPathsFromSelection,
  type ReviewQueueSelection,
  type QueueItem,
  type ReviewQueue,
} from "@re/workspace";

const FileSystemAndPath = Layer.mergeAll(BunFileSystem.layer, Path.layer);

const BaseLive = Layer.mergeAll(
  FileSystemAndPath,
  DeckManagerLive.pipe(Layer.provide(FileSystemAndPath)),
);

export const AppLive = Layer.mergeAll(
  FileSystemAndPath,
  ReviewQueueLive.pipe(Layer.provide(BaseLive)),
);
