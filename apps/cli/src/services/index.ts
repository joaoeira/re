import { Layer } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { Path } from "@effect/platform";

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
  type QueueItem,
  type ReviewQueue,
} from "@re/workspace";
export {
  ReviewQueueService,
  ReviewQueueServiceLive,
  ReviewQueueLive,
  type Selection,
} from "./ReviewQueue";

import { DeckManagerLive } from "@re/workspace";
import { ReviewQueueLive } from "./ReviewQueue";

const FileSystemAndPath = Layer.mergeAll(BunFileSystem.layer, Path.layer);

const BaseLive = Layer.mergeAll(
  FileSystemAndPath,
  DeckManagerLive.pipe(Layer.provide(FileSystemAndPath)),
);

export const AppLive = Layer.mergeAll(
  FileSystemAndPath,
  ReviewQueueLive.pipe(Layer.provide(BaseLive)),
);
