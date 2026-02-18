import {
  ReviewDuePolicy,
  ReviewQueueBuilder,
  ReviewQueueBuilderLive,
  resolveDueDateIfDue,
  ShuffledOrderingStrategy,
  type ReviewQueue as WorkspaceReviewQueue,
} from "@re/workspace";
import { Context, Effect, Layer, Option } from "effect";

import type { DeckTreeNode } from "../lib/buildDeckTree";

export type Selection =
  | { readonly type: "all" }
  | { readonly type: "folder"; readonly path: string }
  | { readonly type: "deck"; readonly path: string };

export interface ReviewQueueService {
  readonly buildQueue: (
    selection: Selection,
    tree: readonly DeckTreeNode[],
    rootPath: string,
    now: Date,
  ) => Effect.Effect<WorkspaceReviewQueue>;
}

export const ReviewQueueService = Context.GenericTag<ReviewQueueService>("ReviewQueueService");

const collectDeckPaths = (selection: Selection, tree: readonly DeckTreeNode[]): string[] => {
  const paths: string[] = [];

  const collectFromNode = (node: DeckTreeNode): void => {
    if (node.type === "deck") {
      paths.push(node.stats.path);
    } else {
      for (const child of node.children) {
        collectFromNode(child);
      }
    }
  };

  const findAndCollect = (nodes: readonly DeckTreeNode[], targetPath: string): boolean => {
    for (const node of nodes) {
      if (node.type === "folder" && node.path === targetPath) {
        collectFromNode(node);
        return true;
      }
      if (node.type === "deck" && node.stats.path === targetPath) {
        paths.push(node.stats.path);
        return true;
      }
      if (node.type === "folder") {
        if (findAndCollect(node.children, targetPath)) return true;
      }
    }
    return false;
  };

  switch (selection.type) {
    case "all":
      for (const node of tree) {
        collectFromNode(node);
      }
      break;
    case "folder":
      findAndCollect(tree, selection.path);
      break;
    case "deck":
      findAndCollect(tree, selection.path);
      break;
  }

  return paths;
};

export const SchedulerDuePolicyLive = Layer.effect(
  ReviewDuePolicy,
  Effect.succeed({
    dueDateIfDue: (card, now) => Option.fromNullable(resolveDueDateIfDue(card, now)),
  }),
);

const QueueBuilderFromCliDeps = ReviewQueueBuilderLive.pipe(
  Layer.provideMerge(SchedulerDuePolicyLive),
);

export const ReviewQueueServiceLive = Layer.effect(
  ReviewQueueService,
  Effect.gen(function* () {
    const queueBuilder = yield* ReviewQueueBuilder;

    return {
      buildQueue: (selection, tree, rootPath, now) =>
        queueBuilder.buildQueue({
          deckPaths: collectDeckPaths(selection, tree),
          rootPath,
          now,
        }),
    };
  }),
).pipe(Layer.provide(QueueBuilderFromCliDeps));

// Convenience layer with default (shuffled) ordering
export const ReviewQueueLive = ReviewQueueServiceLive.pipe(Layer.provide(ShuffledOrderingStrategy));
