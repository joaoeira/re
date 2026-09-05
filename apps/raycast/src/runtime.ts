import { Path } from "@effect/platform";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { SchedulerLive } from "@re/scheduler";
import { DeckManagerLive, ReviewQueueBuilderLive, ShuffledOrderingStrategy } from "@re/workspace";
import { Effect, Layer, ManagedRuntime } from "effect";

import { ClipboardImageReader } from "./clipboard-image";
import { ClipboardImageReaderLive } from "./clipboard-image-live";
import { DeckStore, DeckStoreLive } from "./deck-store";
import { ReviewStore, ReviewStoreLive } from "./review-store";

const PlatformLive = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const DeckManagerAndPlatformLive = DeckManagerLive.pipe(Layer.provideMerge(PlatformLive));
const ReviewQueueAndDependenciesLive = ReviewQueueBuilderLive.pipe(
  Layer.provideMerge(
    Layer.mergeAll(DeckManagerAndPlatformLive, ShuffledOrderingStrategy, PlatformLive),
  ),
);
const DeckStoreConfiguredLive = DeckStoreLive.pipe(Layer.provide(DeckManagerAndPlatformLive));
const ReviewStoreConfiguredLive = ReviewStoreLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      ReviewQueueAndDependenciesLive,
      DeckManagerAndPlatformLive,
      SchedulerLive,
      PlatformLive,
    ),
  ),
);
const AppLive = Layer.mergeAll(
  ClipboardImageReaderLive,
  DeckStoreConfiguredLive,
  ReviewStoreConfiguredLive,
  NodePath.layer,
);

const runtime = ManagedRuntime.make(AppLive);

export const runRaycastEffect = <A>(
  effect: Effect.Effect<A, never, ClipboardImageReader | DeckStore | ReviewStore | Path.Path>,
): Promise<A> => runtime.runPromise(effect);
