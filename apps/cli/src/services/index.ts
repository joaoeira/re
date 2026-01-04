import { Layer } from "effect"
import { BunFileSystem } from "@effect/platform-bun"

export {
  DeckDiscovery,
  DeckDiscoveryLive,
  type DiscoveryResult,
} from "./DeckDiscovery"
export { Scheduler, SchedulerLive } from "./Scheduler"
export { DeckLoader, DeckLoaderLive, type DeckStats } from "./DeckLoader"
export { buildDeckTree, type DeckTreeNode } from "../lib/buildDeckTree"

import { DeckDiscoveryLive } from "./DeckDiscovery"
import { SchedulerLive } from "./Scheduler"
import { DeckLoaderLive } from "./DeckLoader"

// Full application layer
export const AppLive = Layer.merge(DeckDiscoveryLive, DeckLoaderLive).pipe(
  Layer.provide(Layer.merge(BunFileSystem.layer, SchedulerLive))
)
