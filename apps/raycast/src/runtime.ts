import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { DeckManagerLive } from "@re/workspace";
import { Effect, Layer, ManagedRuntime } from "effect";

import { DeckStore, DeckStoreLive } from "./deck-store";

const PlatformLive = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const DeckManagerAndPlatformLive = DeckManagerLive.pipe(
  Layer.provideMerge(PlatformLive),
);
const AppLive = DeckStoreLive.pipe(Layer.provide(DeckManagerAndPlatformLive));

const runtime = ManagedRuntime.make(AppLive);

export const runRaycastEffect = <A>(
  effect: Effect.Effect<A, never, DeckStore>,
): Promise<A> => runtime.runPromise(effect);
